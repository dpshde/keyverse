defmodule Keyverse.OpLog do
  @moduledoc """
  Append-only op DAG under `pack/ops/<slug>/<hash>.json` (PROTOCOL.md §10).

  Each file is an op record: a group of primitive ops applied atomically, with
  `parents` (hashes of the records it causally follows) and a Lamport counter.
  The filename is the SHA-256 of the record's canonical JSON encoding
  (`Keyverse.CanonicalJson`), CAS-style: appending is creating a file, which
  is naturally conflict-free on a plain filesystem.

  The snapshot (`notes/<slug>.json`) remains the canonical projection for
  clients that don't read the log. `record_transition!/4` heals out-of-band
  snapshot edits by synthesizing an implicit record before logging the edit.

  Callers MUST hold the pack's `Keyverse.Pack.Writer` lock.
  """

  require Logger

  alias Keyverse.{CanonicalJson, Fold}

  @record_v 1

  def ops_root(pack_dir), do: Path.join(pack_dir, "ops")
  def ops_dir(pack_dir, slug), do: Path.join(ops_root(pack_dir), slug)

  @doc "All op records for a slug: `[%{hash: h, record: map}]`. Skips unreadable files."
  def list(pack_dir, slug) do
    dir = ops_dir(pack_dir, slug)

    case File.ls(dir) do
      {:ok, files} ->
        files
        |> Enum.filter(&String.ends_with?(&1, ".json"))
        |> Enum.map(fn f ->
          hash = String.trim_trailing(f, ".json")

          with {:ok, body} <- File.read(Path.join(dir, f)),
               {:ok, record} when is_map(record) <- Jason.decode(body) do
            %{hash: hash, record: record}
          else
            _ -> nil
          end
        end)
        |> Enum.reject(&is_nil/1)

      _ ->
        []
    end
  end

  @doc "Hashes not referenced as any record's parent (the DAG frontier)."
  def heads(records) do
    referenced =
      records
      |> Enum.flat_map(fn %{record: rec} -> List.wrap(rec["parents"]) end)
      |> MapSet.new()

    records
    |> Enum.map(& &1.hash)
    |> Enum.reject(&MapSet.member?(referenced, &1))
    |> Enum.sort()
  end

  def next_lamport(records) do
    max =
      records |> Enum.map(fn %{record: rec} -> rec["lamport"] || 0 end) |> Enum.max(fn -> 0 end)

    max + 1
  end

  @doc """
  Append one op record; returns `%{hash: h, record: map}`.

  `ops` is a list of primitive ops (see `Keyverse.Fold`). Parents/lamport are
  derived from `records` (the current log). Options:

  - `implicit: true` — synthesized from out-of-band snapshot edits
  - `at: iso8601` — wall-clock stamp (default: now). Use note `created_at` when
    seeding the log from an existing snapshot so activity isn't all "today".
  """
  def append!(pack_dir, slug, records, ops, opts \\ []) do
    at =
      case opts[:at] do
        stamp when is_binary(stamp) and stamp != "" -> stamp
        _ -> Keyverse.Note.iso_now()
      end

    record =
      %{
        "v" => @record_v,
        "slug" => slug,
        "parents" => heads(records),
        "lamport" => next_lamport(records),
        "at" => at,
        "ops" => ops
      }
      |> then(fn r -> if opts[:implicit], do: Map.put(r, "implicit", true), else: r end)

    # File bytes ARE the canonical encoding: sha256(file bytes) == filename.
    body = CanonicalJson.encode(record)
    hash = :crypto.hash(:sha256, body) |> Base.encode16(case: :lower)
    dir = ops_dir(pack_dir, slug)
    File.mkdir_p!(dir)
    path = Path.join(dir, hash <> ".json")

    unless File.exists?(path) do
      File.write!(path, body)
    end

    %{hash: hash, record: record}
  end

  @doc """
  Log the transition `before_state → after_state` (clean states, see
  `Keyverse.Fold.state_from_note/1`).

  If the log's fold disagrees with `before_state`, an implicit record healing
  the divergence (out-of-band snapshot edit) is appended first. Pass
  `before_state: nil` to diff directly from the fold state (used when the
  previous snapshot was encrypted and carries no plaintext to compare).

  Options:

  - `at: iso8601` — when seeding an empty log from an existing note (empty fold
    → content), stamp the seed/bootstrap record with the note's `created_at`
    so a bulk mirror does not mark every note as edited "now".

  Empty diffs are a no-op (no record written) — safe for idempotent sync PUTs
  once the log already matches the snapshot.

  Never raises: op logging must not break note capture. On error it logs a
  warning and returns `:error`; the next transition heals via the implicit
  mechanism.
  """
  def record_transition!(pack_dir, slug, before_state, after_state, opts \\ []) do
    records = list(pack_dir, slug)
    fold_state = Fold.materialize(Fold.fold(records))
    stamp = bootstrap_stamp(opts[:at])

    {records, base_state} =
      cond do
        is_nil(before_state) ->
          {records, fold_state}

        Fold.equal?(fold_state, before_state) ->
          {records, before_state}

        true ->
          ops = Fold.diff(fold_state, before_state)

          if ops == [] do
            {records, before_state}
          else
            # Empty fold → existing snapshot: seed the log (often bulk sync after
            # ops were introduced). Prefer created_at so activity keeps history.
            heal_opts =
              [implicit: true]
              |> maybe_put_at(empty_state?(fold_state) && stamp)

            rec = append!(pack_dir, slug, records, ops, heal_opts)
            {records ++ [rec], before_state}
          end
      end

    case Fold.diff(base_state, after_state) do
      [] ->
        # No content change — critical for mirror PUT of unchanged notes.
        :ok

      ops ->
        # First real write into an empty base: also prefer created_at when given.
        main_opts = maybe_put_at([], empty_state?(base_state) && stamp)
        _ = append!(pack_dir, slug, records, ops, main_opts)
        :ok
    end
  rescue
    e ->
      Logger.warning("op log write failed for #{slug}: #{Exception.message(e)}")
      :error
  end

  defp bootstrap_stamp(stamp) when is_binary(stamp) and stamp != "", do: stamp
  defp bootstrap_stamp(_), do: nil

  defp maybe_put_at(opts, stamp) when is_binary(stamp) and stamp != "",
    do: Keyword.put(opts, :at, stamp)

  defp maybe_put_at(opts, _), do: opts

  defp empty_state?(state), do: Fold.equal?(state, Fold.empty_state()) or empty_blocks?(state)

  defp empty_blocks?(%{"blocks" => blocks}) when is_list(blocks) do
    Enum.all?(blocks, fn b ->
      not is_map(b) or String.trim(to_string(b["text"] || "")) == ""
    end)
  end

  defp empty_blocks?(_), do: true
end
