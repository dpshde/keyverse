defmodule Keyverse.Note do
  @moduledoc "Read/write note JSON records in a pack."

  alias Keyverse.Pack

  def path(pack_dir, slug), do: Path.join(Pack.notes_dir(pack_dir), "#{slug}.json")

  def read(pack_dir, slug) do
    case File.read(path(pack_dir, slug)) do
      {:ok, body} ->
        case Jason.decode(body) do
          {:ok, note} -> hydrate(note)
          _ -> nil
        end

      _ ->
        nil
    end
  end

  def write!(pack_dir, note) do
    slug = get_in(note, ["scope", "slug"]) || note["scope"]["slug"]
    File.mkdir_p!(Pack.notes_dir(pack_dir))
    body = Jason.encode!(note, pretty: true)
    File.write!(path(pack_dir, slug), body <> "\n")
    note
  end

  def delete!(pack_dir, slug) do
    File.rm(path(pack_dir, slug))
    :ok
  end

  def list(pack_dir) do
    dir = Pack.notes_dir(pack_dir)

    case File.ls(dir) do
      {:ok, files} ->
        files
        |> Enum.filter(&String.ends_with?(&1, ".json"))
        |> Enum.map(&read_file_note(dir, &1))
        |> Enum.reject(&is_nil/1)
        |> Enum.sort_by(fn n -> n["updated_at"] || "" end, :desc)

      _ ->
        []
    end
  end

  @doc """
  Notes whose slug is this chapter or a verse/range inside it.
  Uses filename prefix (no full-pack JSON parse of other books).
  """
  def list_for_chapter(pack_dir, book, chapter) when is_binary(book) and is_integer(chapter) do
    dir = Pack.notes_dir(pack_dir)
    prefix = "#{String.downcase(book)}.#{chapter}"

    case File.ls(dir) do
      {:ok, files} ->
        files
        |> Enum.filter(fn f ->
          String.ends_with?(f, ".json") and
            (f == prefix <> ".json" or String.starts_with?(f, prefix <> "."))
        end)
        |> Enum.map(&read_file_note(dir, &1))
        |> Enum.reject(&is_nil/1)

      _ ->
        []
    end
  end

  defp read_file_note(dir, f) do
    case File.read(Path.join(dir, f)) do
      {:ok, body} ->
        case Jason.decode(body) do
          {:ok, note} -> hydrate(note)
          _ -> nil
        end

      _ ->
        nil
    end
  end

  def encrypted?(note) when is_map(note) do
    note["encrypted"] == true or is_map(note["cipher"])
  end

  def encrypted?(_), do: false

  def blocks_empty?(blocks) do
    Enum.all?(List.wrap(blocks), fn b ->
      String.trim(to_string(b["text"] || "")) == ""
    end)
  end

  def has_content?(blocks) do
    Enum.any?(List.wrap(blocks), fn b ->
      String.trim(to_string(b["text"] || "")) != ""
    end)
  end

  def normalize_blocks(raw) when is_list(raw) do
    raw
    |> Enum.with_index()
    |> Enum.map(fn {b, i} ->
      id = b["id"] || b[:id] || "b_#{System.system_time(:millisecond)}_#{i}"

      %{
        "id" => to_string(id),
        "indent" => max(0, trunc(b["indent"] || b[:indent] || 0)),
        "text" => to_string(b["text"] || b[:text] || "")
      }
      |> then(fn m ->
        if b["collapsed"] || b[:collapsed], do: Map.put(m, "collapsed", true), else: m
      end)
    end)
  end

  def normalize_blocks(_), do: []

  def serialize_blocks(blocks) do
    blocks
    |> List.wrap()
    |> Enum.map(fn b ->
      indent = b["indent"] || 0
      String.duplicate("  ", indent) <> to_string(b["text"] || "")
    end)
    |> Enum.join("\n")
  end

  def parse_interchange_text(text) do
    text
    |> to_string()
    |> String.split("\n")
    |> Enum.with_index()
    |> Enum.map(fn {line, i} ->
      # leading spaces / 2
      stripped = String.replace_leading(line, " ", "")
      spaces = String.length(line) - String.length(stripped)
      indent = div(spaces, 2)

      %{
        "id" => "b_#{System.system_time(:millisecond)}_#{i}",
        "indent" => indent,
        "text" => stripped
      }
    end)
  end

  def hydrate(note) when is_map(note) do
    note =
      if note["blocks"] do
        note
      else
        body = note["body"] || ""
        blocks = parse_interchange_text(body)
        Map.put(note, "blocks", blocks)
      end

    note
    |> Map.put_new("attachments", [])
    |> Map.update("blocks", [], &normalize_blocks/1)
  end

  def new_id(prefix \\ "note") do
    "#{prefix}_#{Integer.to_string(System.system_time(:millisecond), 36)}#{random_hex(4)}"
  end

  def new_block_id, do: new_id("b")
  def new_att_id, do: new_id("att")

  defp random_hex(n) do
    :crypto.strong_rand_bytes(n) |> Base.encode16(case: :lower) |> binary_part(0, n * 2)
  end

  def normalize_attachments(list) when is_list(list) do
    list
    |> Enum.reduce({[], MapSet.new()}, fn raw, {out, seen} ->
      cond do
        not is_map(raw) ->
          {out, seen}

        true ->
          id = to_string(raw["id"] || new_att_id())

          if MapSet.member?(seen, id) do
            {out, seen}
          else
            att =
              case raw["kind"] do
                "url" ->
                  url =
                    case Keyverse.Attach.validate_url(to_string(raw["url"] || "")) do
                      {:ok, u} -> u
                      _ -> ""
                    end

                  %{
                    "id" => id,
                    "kind" => "url",
                    "url" => url,
                    "title" => Keyverse.Attach.sanitize_title(raw["title"]),
                    "created_at" => raw["created_at"] || iso_now()
                  }

                _ ->
                  sha =
                    raw["sha256"]
                    |> to_string()
                    |> String.downcase()
                    |> String.replace(~r/[^a-f0-9]/, "")

                  sha = if String.length(sha) == 64, do: sha, else: ""

                  %{
                    "id" => id,
                    "kind" => "file",
                    "name" => Keyverse.Attach.sanitize_filename(raw["name"] || "file"),
                    "mime" =>
                      Keyverse.Attach.sanitize_mime(raw["mime"] || "application/octet-stream"),
                    "sha256" => sha,
                    "bytes" => max(0, trunc(raw["bytes"] || 0)),
                    "created_at" => raw["created_at"] || iso_now()
                  }
              end

            # drop broken rows
            keep =
              case att["kind"] do
                "url" -> att["url"] != ""
                "file" -> att["sha256"] != ""
                _ -> false
              end

            if keep, do: {out ++ [att], MapSet.put(seen, id)}, else: {out, seen}
          end
      end
    end)
    |> elem(0)
  end

  def normalize_attachments(_), do: []

  def iso_now do
    DateTime.utc_now() |> DateTime.truncate(:millisecond) |> DateTime.to_iso8601()
  end

  def put_note(pack_dir, scope, attrs) do
    Keyverse.Pack.Writer.call(pack_dir, fn -> put_note_locked(pack_dir, scope, attrs) end)
  end

  defp put_note_locked(pack_dir, scope, attrs) do
    existing = read(pack_dir, scope.slug)
    now = iso_now()

    encrypted = attrs[:encrypted] == true or attrs["encrypted"] == true

    cond do
      encrypted ->
        cipher = attrs[:cipher] || attrs["cipher"]

        note = %{
          "id" => (existing && existing["id"]) || new_id(),
          "scope" => scope_map(scope),
          "encrypted" => true,
          "cipher" => cipher,
          "blocks" => [],
          "attachments" => [],
          "created_at" => (existing && existing["created_at"]) || now,
          "updated_at" => now
        }

        # Sealed notes never log plaintext ops; the log freezes (PROTOCOL §10.6).
        write!(pack_dir, note)

      true ->
        blocks = attrs[:blocks] || attrs["blocks"] || []
        blocks = normalize_blocks(blocks)

        attachments =
          cond do
            Map.has_key?(attrs, :attachments) or Map.has_key?(attrs, "attachments") ->
              normalize_attachments(attrs[:attachments] || attrs["attachments"])

            existing && not encrypted?(existing) ->
              existing["attachments"] || []

            true ->
              []
          end

        if blocks_empty?(blocks) and attachments == [] do
          if existing, do: delete!(pack_dir, scope.slug)
          log_transition(pack_dir, scope.slug, existing, Keyverse.Fold.state_from_note(nil))
          {:deleted, true}
        else
          note = %{
            "id" => (existing && existing["id"]) || new_id(),
            "scope" => scope_map(scope),
            "blocks" => blocks,
            "attachments" => attachments,
            "created_at" => (existing && existing["created_at"]) || now,
            "updated_at" => now
          }

          write!(pack_dir, note)
          log_transition(pack_dir, scope.slug, existing, Keyverse.Fold.state_from_note(note))
          {:ok, note}
        end
    end
  end

  # Append op records for a plaintext state transition (PROTOCOL §10).
  # Unsealing (existing encrypted → plaintext) diffs from the fold state,
  # since the sealed snapshot carries no plaintext to compare.
  #
  # When seeding an empty op log from an existing note (mirror / first deploy
  # of ops), pass created_at so activity is not bulk-stamped "now".
  defp log_transition(pack_dir, slug, existing, after_state) do
    before_state =
      if existing && encrypted?(existing),
        do: nil,
        else: Keyverse.Fold.state_from_note(existing)

    opts =
      case existing do
        %{"created_at" => at} when is_binary(at) and at != "" -> [at: at]
        _ -> []
      end

    Keyverse.OpLog.record_transition!(pack_dir, slug, before_state, after_state, opts)
  end

  def scope_map(scope) do
    %{
      "kind" => scope.kind,
      "osis" => scope.osis,
      "slug" => scope.slug
    }
  end

  def write_attachment_blob!(pack_dir, bin) when is_binary(bin) do
    Keyverse.Pack.Writer.call(pack_dir, fn -> write_attachment_blob_locked(pack_dir, bin) end)
  end

  defp write_attachment_blob_locked(pack_dir, bin) when is_binary(bin) do
    sha = :crypto.hash(:sha256, bin) |> Base.encode16(case: :lower)

    case Keyverse.PackQuota.check_add_blob(pack_dir, sha, byte_size(bin)) do
      :ok ->
        dir = Pack.attach_dir(pack_dir)
        File.mkdir_p!(dir)
        path = Path.join(dir, sha)
        unless File.exists?(path), do: File.write!(path, bin)
        {:ok, sha}

      {:error, reason, usage} ->
        Keyverse.Metrics.record(:quota_reject, 0, %{error: true})
        {:error, reason, usage}
    end
  end

  @doc "Append attachment metadata on a note (writer-serialized)."
  def attach_meta!(pack_dir, scope, existing, att) when is_map(att) do
    Keyverse.Pack.Writer.call(pack_dir, fn ->
      # re-read under lock
      existing = read(pack_dir, scope.slug) || existing
      atts = (existing && existing["attachments"]) || []

      case Keyverse.Attach.check_count(atts) do
        {:error, msg} ->
          {:error, msg}

        :ok ->
          now = iso_now()
          att = normalize_attachments([att]) |> List.first() || att

          note = %{
            "id" => (existing && existing["id"]) || new_id(),
            "scope" => scope_map(scope),
            "blocks" => (existing && existing["blocks"]) || [],
            "attachments" => atts ++ [att],
            "created_at" => (existing && existing["created_at"]) || now,
            "updated_at" => now
          }

          write!(pack_dir, note)
          log_transition(pack_dir, scope.slug, existing, Keyverse.Fold.state_from_note(note))
          {:ok, note}
      end
    end)
  end

  @doc "Remove attachment metadata; GC blob if unreferenced."
  def detach_meta!(pack_dir, scope, note, att_id) do
    Keyverse.Pack.Writer.call(pack_dir, fn ->
      note = read(pack_dir, scope.slug) || note

      if is_nil(note) do
        {:error, :not_found}
      else
        removed = Enum.find(note["attachments"] || [], &(&1["id"] == att_id))

        if is_nil(removed) do
          {:error, :not_found}
        else
          before_note = note
          atts = Enum.reject(note["attachments"] || [], &(&1["id"] == att_id))
          note = note |> Map.put("attachments", atts) |> Map.put("updated_at", iso_now())
          write!(pack_dir, note)
          log_transition(pack_dir, scope.slug, before_note, Keyverse.Fold.state_from_note(note))

          if removed["kind"] == "file" && removed["sha256"] do
            unless attachment_referenced?(pack_dir, removed["sha256"], scope.slug) do
              path = attach_blob_path(pack_dir, removed["sha256"])
              if path, do: File.rm(path)
            end
          end

          {:ok, note}
        end
      end
    end)
  end

  @doc "Best-effort mime/name lookup for a CAS blob."
  def attachment_meta_for_sha(pack_dir, sha) do
    sha = String.downcase(to_string(sha))

    Enum.find_value(list(pack_dir), {"application/octet-stream", "file"}, fn n ->
      case Enum.find(n["attachments"] || [], &(&1["kind"] == "file" and &1["sha256"] == sha)) do
        nil -> nil
        a -> {a["mime"] || "application/octet-stream", a["name"] || "file"}
      end
    end)
  end

  def attach_blob_path(pack_dir, sha256) do
    hex = sha256 |> to_string() |> String.downcase() |> String.replace(~r/[^a-f0-9]/, "")

    if String.length(hex) == 64 do
      Path.join(Pack.attach_dir(pack_dir), hex)
    else
      nil
    end
  end

  def attachment_referenced?(pack_dir, sha256, except_slug \\ nil) do
    list(pack_dir)
    |> Enum.any?(fn n ->
      if except_slug && get_in(n, ["scope", "slug"]) == except_slug do
        false
      else
        Enum.any?(n["attachments"] || [], fn a ->
          a["kind"] == "file" and a["sha256"] == sha256
        end)
      end
    end)
  end
end
