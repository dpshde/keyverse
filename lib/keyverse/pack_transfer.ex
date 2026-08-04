defmodule Keyverse.PackTransfer do
  @moduledoc """
  User-owned pack import/export.

  The pack directory is the product. Export produces a portable zip of **user
  data** only (protocol.json, door, notes/, attachments/, ops/). Disposable
  scripture cache (`text/`, host `_cache/`) is never included.

  Import restores a zip into a pack directory (merge or replace). Merge unions
  op records by content hash (PROTOCOL §10.7) — union *is* merge.
  """

  alias Keyverse.Pack

  @user_files ~w(protocol.json door)
  @user_dirs ~w(notes attachments ops)

  @doc """
  Build an in-memory zip of user-owned pack contents.

  Returns `{:ok, filename, binary}` or `{:error, reason}`.
  """
  def export_zip(pack_dir, opts \\ []) do
    pack_dir = Path.expand(pack_dir)

    unless File.dir?(pack_dir) do
      {:error, "pack directory not found"}
    else
      entries = collect_export_entries(pack_dir)

      if entries == [] do
        {:error, "pack has no exportable user data"}
      else
        # :zip wants charlists for names on older OTP; binaries work on OTP 24+
        zip_entries =
          Enum.map(entries, fn {rel, abs} ->
            {String.to_charlist(rel), File.read!(abs)}
          end)

        name =
          Keyword.get(opts, :name) ||
            default_export_name(pack_dir)

        case :zip.create(String.to_charlist(name), zip_entries, [:memory]) do
          {:ok, {_name, bin}} when is_binary(bin) ->
            {:ok, name, bin}

          {:error, reason} ->
            {:error, inspect(reason)}
        end
      end
    end
  end

  @doc """
  Import a pack zip into `pack_dir`.

  Options:
  - `:mode` — `:merge` (default) overwrites files present in the zip;
    `:replace` clears `notes/`, `attachments/`, and `ops/` first (keeps door if zip lacks it)
  - `:validate` — run conformance after import (default true)

  Zip entry paths may be flat (`notes/…`) or wrapped in a single top-level folder
  (`my-pack/notes/…`) as when a user compresses a pack directory in Finder.
  """
  def import_zip(pack_dir, zip_binary, opts \\ []) when is_binary(zip_binary) do
    pack_dir = Path.expand(pack_dir)
    mode = Keyword.get(opts, :mode, :merge)
    validate? = Keyword.get(opts, :validate, true)

    Keyverse.Pack.Writer.call(pack_dir, fn ->
      import_zip_locked(pack_dir, zip_binary, mode, validate?)
    end)
  end

  defp import_zip_locked(pack_dir, zip_binary, mode, validate?) do
    File.mkdir_p!(pack_dir)

    case :zip.extract(zip_binary, [:memory]) do
      {:ok, files} when is_list(files) ->
        normalized =
          files
          |> Enum.map(fn {name, data} -> {safe_rel(to_string(name)), data} end)
          |> Enum.reject(fn {rel, _} -> is_nil(rel) end)

        if normalized == [] do
          {:error, "zip contained no safe pack paths"}
        else
          if mode == :replace do
            File.rm_rf!(Path.join(pack_dir, "notes"))
            File.rm_rf!(Path.join(pack_dir, "attachments"))
            File.rm_rf!(Path.join(pack_dir, "ops"))
          end

          Enum.each(normalized, fn {rel, data} ->
            dest = Path.join(pack_dir, rel)
            File.mkdir_p!(Path.dirname(dest))
            File.write!(dest, data)
          end)

          Pack.ensure_dirs!(pack_dir)

          if validate? do
            report = Keyverse.Protocol.Conformance.validate_pack(pack_dir)

            if report.ok? do
              {:ok, %{mode: mode, files: length(normalized), report: report}}
            else
              {:error, {:conformance_failed, report}}
            end
          else
            {:ok, %{mode: mode, files: length(normalized)}}
          end
        end

      {:error, reason} ->
        {:error, "invalid zip: #{inspect(reason)}"}
    end
  end

  @doc "Copy a pack directory tree (user data only) into dest."
  def copy_pack(src, dest) do
    src = Path.expand(src)
    dest = Path.expand(dest)

    unless File.dir?(src), do: throw({:error, "source not a directory"})

    File.mkdir_p!(dest)

    for name <- @user_files do
      from = Path.join(src, name)
      if File.regular?(from), do: File.cp!(from, Path.join(dest, name))
    end

    for dir <- @user_dirs do
      from = Path.join(src, dir)

      if File.dir?(from) do
        File.cp_r!(from, Path.join(dest, dir))
      else
        File.mkdir_p!(Path.join(dest, dir))
      end
    end

    Pack.ensure_dirs!(dest)
    {:ok, dest}
  catch
    {:error, _} = e -> e
  end

  @doc "Summary of user-owned content (for ownership UI / API)."
  def manifest(pack_dir) do
    pack_dir = Path.expand(pack_dir)
    notes_dir = Path.join(pack_dir, "notes")
    att_dir = Path.join(pack_dir, "attachments")

    note_files =
      case File.ls(notes_dir) do
        {:ok, fs} -> Enum.count(fs, &String.ends_with?(&1, ".json"))
        _ -> 0
      end

    {att_count, att_bytes} =
      case File.ls(att_dir) do
        {:ok, fs} ->
          Enum.reduce(fs, {0, 0}, fn f, {c, b} ->
            path = Path.join(att_dir, f)

            case File.stat(path) do
              {:ok, %{size: s, type: :regular}} -> {c + 1, b + s}
              _ -> {c, b}
            end
          end)

        _ ->
          {0, 0}
      end

    protocol =
      case File.read(Path.join(pack_dir, "protocol.json")) do
        {:ok, body} ->
          case Jason.decode(body) do
            {:ok, map} -> map
            _ -> nil
          end

        _ ->
          nil
      end

    door =
      case File.read(Path.join(pack_dir, "door")) do
        {:ok, body} -> String.trim(body)
        _ -> nil
      end

    %{
      protocol: protocol,
      door: door,
      notes: note_files,
      attachments: att_count,
      attachment_bytes: att_bytes,
      user_owned: true,
      export: %{
        includes: ["protocol.json", "door", "notes/", "attachments/", "ops/"],
        excludes: ["text/", "_cache/", ".git/"]
      }
    }
  end

  # --- helpers -------------------------------------------------------------

  defp collect_export_entries(pack_dir) do
    files =
      for name <- @user_files,
          path = Path.join(pack_dir, name),
          File.regular?(path),
          do: {name, path}

    dir_files =
      Enum.flat_map(@user_dirs, fn dir ->
        root = Path.join(pack_dir, dir)

        if File.dir?(root) do
          root
          |> Path.join("**")
          |> Path.wildcard(match_dot: false)
          |> Enum.filter(&File.regular?/1)
          |> Enum.map(fn abs ->
            rel = Path.relative_to(abs, pack_dir)
            {rel, abs}
          end)
        else
          []
        end
      end)

    # stable order
    Enum.sort_by(files ++ dir_files, fn {rel, _} -> rel end)
  end

  defp default_export_name(pack_dir) do
    door =
      case File.read(Path.join(pack_dir, "door")) do
        {:ok, body} ->
          body |> String.trim() |> String.replace(~r/[^a-z0-9\-]+/i, "-") |> String.slice(0, 64)

        _ ->
          "pack"
      end

    door = if door == "", do: "pack", else: door
    stamp = Calendar.strftime(DateTime.utc_now(), "%Y%m%d")
    "keyverse-#{door}-#{stamp}.zip"
  end

  # Only allow pack-relative user paths; reject absolute / .. / host junk.
  # Accepts a single wrapper directory (Finder "Compress" of a pack folder).
  defp safe_rel(name) do
    name =
      name
      |> String.replace("\\", "/")
      |> String.trim_leading("/")
      |> strip_wrapper_dir()

    cond do
      name == "" ->
        nil

      String.contains?(name, "..") ->
        nil

      String.starts_with?(name, "/") ->
        nil

      name in @user_files ->
        name

      String.starts_with?(name, "notes/") and not String.contains?(name, "//") and
          String.ends_with?(name, ".json") ->
        name

      String.starts_with?(name, "attachments/") and
          Regex.match?(~r/^attachments\/[a-f0-9]{64}$/, name) ->
        name

      String.starts_with?(name, "ops/") and
          Regex.match?(~r/^ops\/[a-z0-9][a-z0-9.\-]*\/[a-f0-9]{64}\.json$/, name) ->
        name

      # zip may include directory markers
      name in @user_dirs or name in Enum.map(@user_dirs, &(&1 <> "/")) ->
        nil

      true ->
        nil
    end
  end

  # e.g. "my-pack/notes/jhn.3.16.json" → "notes/jhn.3.16.json"
  # Flat export paths and junk (__MACOSX/…) are left unchanged.
  defp strip_wrapper_dir(name) do
    if pack_root_entry?(name) do
      name
    else
      case String.split(name, "/", parts: 2) do
        [wrapper, rest] when wrapper != "" and rest != "" ->
          if not String.contains?(wrapper, "..") and pack_root_entry?(rest) do
            rest
          else
            name
          end

        _ ->
          name
      end
    end
  end

  defp pack_root_entry?(path) do
    path in @user_files or
      path in @user_dirs or
      path in Enum.map(@user_dirs, &(&1 <> "/")) or
      String.starts_with?(path, "notes/") or
      String.starts_with?(path, "attachments/") or
      String.starts_with?(path, "ops/")
  end
end
