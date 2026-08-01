defmodule Keyverse.Protocol.Conformance do
  @moduledoc """
  Offline pack conformance (no HTTP).

  Validates a pack **directory** against PROTOCOL.md MUST rules and the shapes
  in `schemas/`. Second clients can reimplement this; the door is not required.

  See `protocol/fixtures/` and `mix keyverse.conformance`.
  """

  @protocol_name "keyverse"
  @slug_re ~r/^[a-z0-9][a-z0-9.\-]*$/
  @sha_re ~r/^[a-f0-9]{64}$/
  @id_re ~r/^[\w.\-]+$/

  @type error :: %{code: String.t(), path: String.t(), message: String.t()}
  @type report :: %{ok?: boolean(), pack: String.t(), errors: [error()], warnings: [error()]}

  @doc "Validate one pack directory. Returns a report map."
  def validate_pack(pack_dir) when is_binary(pack_dir) do
    pack_dir = Path.expand(pack_dir)
    errors = []
    warnings = []

    {errors, warnings} =
      if File.dir?(pack_dir) do
        {errors, warnings}
      else
        {[{error("not_a_directory", ".", "pack path is not a directory")} | errors], warnings}
      end

    {errors, warnings} =
      if errors != [] do
        {errors, warnings}
      else
        validate_protocol_json(pack_dir, errors, warnings)
      end

    {errors, warnings} =
      if Enum.any?(errors, &(&1.code == "not_a_directory")) do
        {errors, warnings}
      else
        validate_notes_tree(pack_dir, errors, warnings)
      end

    %{
      ok?: errors == [],
      pack: pack_dir,
      errors: Enum.reverse(errors),
      warnings: Enum.reverse(warnings)
    }
  end

  @doc "Validate all packs under protocol/fixtures/{valid,invalid}."
  def validate_fixtures(root \\ "protocol/fixtures") do
    root = Path.expand(root)
    valid_root = Path.join(root, "valid")
    invalid_root = Path.join(root, "invalid")

    valids =
      list_fixture_packs(valid_root)
      |> Enum.map(fn dir ->
        report = validate_pack(dir)
        expect = read_expect(dir)

        cond do
          expect["must_pass"] == false ->
            %{dir: dir, kind: :valid, ok?: false, reason: "expect.json says must_pass:false", report: report}

          report.ok? ->
            %{dir: dir, kind: :valid, ok?: true, report: report}

          true ->
            %{dir: dir, kind: :valid, ok?: false, reason: "expected pass", report: report}
        end
      end)

    invalids =
      list_fixture_packs(invalid_root)
      |> Enum.map(fn dir ->
        report = validate_pack(dir)
        expect = read_expect(dir)
        codes = MapSet.new(Enum.map(report.errors, & &1.code))
        want = List.wrap(expect["error_codes_any"] || expect["error_codes"] || [])

        cond do
          report.ok? ->
            %{dir: dir, kind: :invalid, ok?: false, reason: "expected failure", report: report}

          want != [] and not Enum.any?(want, &MapSet.member?(codes, &1)) ->
            %{
              dir: dir,
              kind: :invalid,
              ok?: false,
              reason: "missing error codes #{inspect(want)}; got #{inspect(MapSet.to_list(codes))}",
              report: report
            }

          true ->
            %{dir: dir, kind: :invalid, ok?: true, report: report}
        end
      end)

    all = valids ++ invalids
    %{ok?: Enum.all?(all, & &1.ok?), cases: all}
  end

  # --- internals -----------------------------------------------------------

  defp list_fixture_packs(root) do
    case File.ls(root) do
      {:ok, names} ->
        names
        |> Enum.map(&Path.join(root, &1))
        |> Enum.filter(&File.dir?/1)
        |> Enum.sort()

      _ ->
        []
    end
  end

  defp read_expect(dir) do
    path = Path.join(dir, "expect.json")

    case File.read(path) do
      {:ok, body} ->
        case Jason.decode(body) do
          {:ok, map} when is_map(map) -> map
          _ -> %{}
        end

      _ ->
        %{}
    end
  end

  defp validate_protocol_json(pack_dir, errors, warnings) do
    path = Path.join(pack_dir, "protocol.json")

    case File.read(path) do
      {:ok, body} ->
        case Jason.decode(body) do
          {:ok, %{"protocol" => @protocol_name, "version" => ver} = doc} when is_binary(ver) ->
            warnings =
              if is_binary(doc["schemas"]),
                do: warnings,
                else: [warning("missing_schemas_field", "protocol.json", "schemas field recommended") | warnings]

            {errors, warnings}

          {:ok, %{"protocol" => other}} ->
            {[error("bad_protocol_name", "protocol.json", "protocol must be \"keyverse\", got #{inspect(other)}") | errors],
             warnings}

          {:ok, _} ->
            {[error("protocol_missing_fields", "protocol.json", "protocol and version are required") | errors],
             warnings}

          {:error, _} ->
            {[error("protocol_not_json", "protocol.json", "invalid JSON") | errors], warnings}
        end

      {:error, :enoent} ->
        # Allowed if notes/ exists (legacy); warn
        if File.dir?(Path.join(pack_dir, "notes")) do
          {errors, [warning("missing_protocol_json", "protocol.json", "missing; recommended for discovery") | warnings]}
        else
          {[error("missing_protocol_json", "protocol.json", "missing protocol.json and notes/") | errors], warnings}
        end

      {:error, reason} ->
        {[error("protocol_unreadable", "protocol.json", inspect(reason)) | errors], warnings}
    end
  end

  defp validate_notes_tree(pack_dir, errors, warnings) do
    notes_dir = Path.join(pack_dir, "notes")

    cond do
      not File.dir?(notes_dir) ->
        # empty pack OK if protocol.json present
        {errors, warnings}

      true ->
        case File.ls(notes_dir) do
          {:ok, files} ->
            files
            |> Enum.filter(&String.ends_with?(&1, ".json"))
            |> Enum.reduce({errors, warnings}, fn file, {e, w} ->
              validate_note_file(pack_dir, Path.join(notes_dir, file), file, e, w)
            end)

          {:error, reason} ->
            {[error("notes_unreadable", "notes/", inspect(reason)) | errors], warnings}
        end
    end
  end

  defp validate_note_file(pack_dir, abs, filename, errors, warnings) do
    slug_from_name = String.trim_trailing(filename, ".json")
    rel = "notes/#{filename}"

    errors =
      if Regex.match?(@slug_re, slug_from_name) do
        errors
      else
        [error("bad_filename_slug", rel, "filename slug is not a valid pack slug") | errors]
      end

    case File.read(abs) do
      {:ok, body} ->
        case Jason.decode(body) do
          {:ok, note} when is_map(note) ->
            validate_note_record(pack_dir, rel, slug_from_name, note, errors, warnings)

          {:ok, _} ->
            {[error("note_not_object", rel, "note JSON must be an object") | errors], warnings}

          {:error, _} ->
            {[error("note_not_json", rel, "invalid JSON") | errors], warnings}
        end

      {:error, reason} ->
        {[error("note_unreadable", rel, inspect(reason)) | errors], warnings}
    end
  end

  defp validate_note_record(pack_dir, rel, slug_from_name, note, errors, warnings) do
    errors =
      errors
      |> require_string(note, "id", rel, "missing_id")
      |> require_map(note, "scope", rel, "missing_scope")
      |> require_string(note, "created_at", rel, "missing_created_at")
      |> require_string(note, "updated_at", rel, "missing_updated_at")

    scope = note["scope"]

    {errors, warnings} =
      if is_map(scope) do
        errors =
          errors
          |> require_string(scope, "kind", "#{rel}#scope", "missing_scope_kind")
          |> require_string(scope, "osis", "#{rel}#scope", "missing_scope_osis")
          |> require_string(scope, "slug", "#{rel}#scope", "missing_scope_slug")

        errors =
          case scope["kind"] do
            k when k in ["verse", "range", "chapter"] -> errors
            nil -> errors
            other -> [error("bad_scope_kind", "#{rel}#scope.kind", "invalid kind #{inspect(other)}") | errors]
          end

        errors =
          cond do
            is_binary(scope["slug"]) and scope["slug"] != slug_from_name ->
              [
                error(
                  "slug_filename_mismatch",
                  rel,
                  "scope.slug #{inspect(scope["slug"])} != filename #{inspect(slug_from_name)}"
                )
                | errors
              ]

            is_binary(scope["slug"]) and is_binary(scope["osis"]) and
                String.downcase(scope["osis"]) != scope["slug"] ->
              [
                error(
                  "slug_osis_mismatch",
                  rel,
                  "scope.slug must be lowercased OSIS"
                )
                | errors
              ]

            true ->
              errors
          end

        {errors, warnings}
      else
        {errors, warnings}
      end

    encrypted? = note["encrypted"] == true

    {errors, warnings} =
      if encrypted? do
        errors =
          if is_map(note["cipher"]) do
            validate_cipher(note["cipher"], "#{rel}#cipher", errors)
          else
            [error("missing_cipher", rel, "encrypted:true requires cipher") | errors]
          end

        # sealed notes SHOULD empty blocks/attachments
        warnings =
          cond do
            is_list(note["blocks"]) and note["blocks"] != [] ->
              [warning("sealed_nonempty_blocks", rel, "encrypted notes should use blocks:[]") | warnings]

            true ->
              warnings
          end

        {errors, warnings}
      else
        blocks = note["blocks"]
        body = note["body"]

        {errors, warnings} =
          cond do
            is_list(blocks) ->
              {validate_blocks(blocks, rel, errors), warnings}

            is_binary(body) ->
              {errors, [warning("legacy_body", rel, "legacy body; clients MUST hydrate to blocks") | warnings]}

            true ->
              # empty note file is odd but allow if only metadata — flag warning
              {errors, [warning("no_blocks_or_body", rel, "no blocks or body") | warnings]}
          end

        atts = note["attachments"] || []

        errors =
          if is_list(atts) do
            Enum.reduce(Enum.with_index(atts), errors, fn {att, i}, acc ->
              validate_attachment(pack_dir, att, "#{rel}#attachments[#{i}]", acc)
            end)
          else
            [error("attachments_not_array", rel, "attachments must be an array") | errors]
          end

        {errors, warnings}
      end

    {errors, warnings}
  end

  defp validate_cipher(cipher, path, errors) when is_map(cipher) do
    errors =
      Enum.reduce(["salt", "iv", "ct"], errors, fn k, acc ->
        if is_binary(cipher[k]) and cipher[k] != "" do
          acc
        else
          [error("cipher_missing_#{k}", "#{path}.#{k}", "required non-empty string") | acc]
        end
      end)

    errors =
      case cipher["v"] do
        nil -> errors
        1 -> errors
        other -> [error("cipher_bad_v", "#{path}.v", "expected 1, got #{inspect(other)}") | errors]
      end

    errors
  end

  defp validate_cipher(_, path, errors),
    do: [error("cipher_not_object", path, "cipher must be an object") | errors]

  defp validate_blocks(blocks, rel, errors) do
    {errors, _} =
      Enum.reduce(Enum.with_index(blocks), {errors, nil}, fn {b, i}, {acc, prev_indent} ->
        path = "#{rel}#blocks[#{i}]"

        acc =
          if is_map(b) do
            acc
            |> require_string(b, "id", path, "block_missing_id")
            |> then(fn a ->
              if is_binary(b["id"]) and not Regex.match?(@id_re, b["id"]),
                do: [error("block_bad_id", "#{path}.id", "invalid id pattern") | a],
                else: a
            end)
            |> then(fn a ->
              indent = b["indent"]

              cond do
                not is_integer(indent) ->
                  [error("block_bad_indent", "#{path}.indent", "indent must be integer") | a]

                indent < 0 or indent > 32 ->
                  [error("block_indent_range", "#{path}.indent", "indent out of range") | a]

                is_integer(prev_indent) and indent > prev_indent + 1 ->
                  [error("block_indent_jump", "#{path}.indent", "indent may increase by at most 1") | a]

                true ->
                  a
              end
            end)
            |> then(fn a ->
              if is_binary(b["text"]) do
                if String.contains?(b["text"], "\n"),
                  do: [error("block_multiline_text", "#{path}.text", "text must be a single line") | a],
                  else: a
              else
                [error("block_missing_text", "#{path}.text", "text required") | a]
              end
            end)
          else
            [error("block_not_object", path, "block must be object") | acc]
          end

        next_prev = if is_map(b) and is_integer(b["indent"]), do: b["indent"], else: prev_indent
        {acc, next_prev}
      end)

    errors
  end

  defp validate_attachment(_pack_dir, att, path, errors) when not is_map(att),
    do: [error("att_not_object", path, "attachment must be object") | errors]

  defp validate_attachment(pack_dir, att, path, errors) when is_map(att) do
    errors =
      if is_binary(att["id"]) and Regex.match?(@id_re, att["id"]) do
        errors
      else
        [error("att_bad_id", "#{path}.id", "invalid or missing id") | errors]
      end

    case att["kind"] do
      "file" ->
        errors =
          Enum.reduce(["name", "mime"], errors, fn k, acc ->
            if is_binary(att[k]), do: acc, else: [error("att_missing_#{k}", "#{path}.#{k}", "required") | acc]
          end)

        errors =
          cond do
            not is_binary(att["sha256"]) or not Regex.match?(@sha_re, att["sha256"]) ->
              [error("att_bad_sha256", "#{path}.sha256", "must be 64 lowercase hex") | errors]

            true ->
              blob = Path.join([pack_dir, "attachments", att["sha256"]])

              if File.regular?(blob) do
                errors
              else
                [error("missing_cas_blob", "attachments/#{att["sha256"]}", "CAS blob missing for file attachment") | errors]
              end
          end

        if is_integer(att["bytes"]) and att["bytes"] >= 0 do
          errors
        else
          [error("att_bad_bytes", "#{path}.bytes", "bytes must be non-negative integer") | errors]
        end

      "url" ->
        if is_binary(att["url"]) and String.match?(att["url"], ~r/^https?:\/\//) do
          errors
        else
          [error("att_bad_url", "#{path}.url", "url must be http(s)") | errors]
        end

      other ->
        [error("att_bad_kind", "#{path}.kind", "kind must be file|url, got #{inspect(other)}") | errors]
    end
  end

  defp require_string(errors, map, key, path, code) do
    if is_binary(map[key]) and map[key] != "" do
      errors
    else
      [error(code, "#{path}.#{key}", "#{key} required string") | errors]
    end
  end

  defp require_map(errors, map, key, path, code) do
    if is_map(map[key]), do: errors, else: [error(code, "#{path}.#{key}", "#{key} required object") | errors]
  end

  defp error(code, path, message), do: %{code: code, path: path, message: message, level: "error"}
  defp warning(code, path, message), do: %{code: code, path: path, message: message, level: "warning"}
end
