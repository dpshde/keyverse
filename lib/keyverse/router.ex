defmodule Keyverse.Router do
  @moduledoc "HTTP multipack door — Plug router."
  use Plug.Router

  alias Keyverse.{Config, Door, Html, Note, Pack, PackTransfer, Scope}

  plug Plug.Parsers,
    parsers: [:urlencoded, :multipart, :json],
    pass: ["*/*"],
    json_decoder: Jason,
    length: 52_428_800

  plug :match
  plug :dispatch

  # ---------- global static / health ----------

  get "/health" do
    health(conn)
  end

  get "/healthz" do
    health(conn)
  end

  get "/metrics" do
    metrics(conn)
  end

  get "/sw.js" do
    send_static(conn, "sw.js", "application/javascript", "no-cache")
  end

  get "/app.css" do
    send_static(conn, "app.css", "text/css; charset=utf-8", "public, max-age=3600")
  end

  get "/crypto.js" do
    send_static(conn, "crypto.js", "application/javascript", "public, max-age=3600")
  end

  get "/outliner.js" do
    send_static(conn, "outliner.js", "application/javascript", "public, max-age=3600")
  end

  get "/pwa-boot.js" do
    send_static(conn, "pwa-boot.js", "application/javascript", "public, max-age=3600")
  end

  get "/editor-page.js" do
    send_static(conn, "editor-page.js", "application/javascript", "public, max-age=3600")
  end

  get "/reader-page.js" do
    send_static(conn, "reader-page.js", "application/javascript", "public, max-age=3600")
  end

  get "/home-tree.js" do
    send_static(conn, "home-tree.js", "application/javascript", "public, max-age=3600")
  end

  get "/door-share.js" do
    send_static(conn, "door-share.js", "application/javascript", "public, max-age=3600")
  end

  get "/ref-search.js" do
    send_static(conn, "ref-search.js", "application/javascript", "public, max-age=3600")
  end

  get "/crypto-bar.js" do
    send_static(conn, "crypto-bar.js", "application/javascript", "public, max-age=3600")
  end

  get "/pack-store.js" do
    send_static(conn, "pack-store.js", "application/javascript", "public, max-age=3600")
  end

  get "/local-mount.js" do
    send_static(conn, "local-mount.js", "application/javascript", "public, max-age=3600")
  end

  get "/local" do
    html(conn, 200, Html.render_local_mount())
  end

  get "/manifest.webmanifest" do
    send_json(conn, 200, Html.web_manifest("/"))
  end

  get "/manifest.json" do
    send_json(conn, 200, Html.web_manifest("/"))
  end

  get "/offline" do
    html(conn, 200, Html.render_offline())
  end

  get "/favicon.ico" do
    send_static(conn, "icons/favicon-32.png", "image/png", "public, max-age=604800, immutable")
  end

  get "/icons/*path" do
    rel = Path.join("icons", Enum.join(path, "/"))
    send_static(conn, rel, mime_for(rel), "public, max-age=604800, immutable")
  end

  # ---------- setup ----------

  get "/setup" do
    if Config.door_open?() do
      redirect(conn, "/")
    else
      html(conn, 200, Html.render_setup(suggested: Door.generate()))
    end
  end

  post "/setup" do
    if Config.door_open?() do
      redirect(conn, "/")
    else
      params = conn.body_params || %{}
      intent = params["intent"] || "claim"

      if intent == "generate" do
        html(conn, 200, Html.render_setup(suggested: Door.generate()))
      else
        case Pack.create(params["door"]) do
          {:ok, claimed} ->
            redirect(conn, "/#{claimed}/")

          {:error, reason} ->
            suggested = Door.normalize(params["door"])
            suggested = if suggested == "", do: Door.generate(), else: suggested
            html(conn, 400, Html.render_setup(error: to_string(reason), suggested: suggested))
        end
      end
    end
  end

  # ---------- enter ----------

  get "/enter" do
    enter(conn)
  end

  get "/login" do
    enter(conn)
  end

  get "/" do
    cond do
      Config.door_open?() ->
        serve_pack(conn, "", Pack.open_path(), "")

      true ->
        html(conn, 200, Html.render_enter(local: local_client?(conn)))
    end
  end

  # ---------- multipack: /{door}/… ----------

  match _ do
    path = conn.request_path || "/"
    parts = path |> String.split("/", trim: true)

    cond do
      Config.door_open?() ->
        serve_pack(conn, path, Pack.open_path(), "")

      parts == [] ->
        html(conn, 200, Html.render_enter(local: local_client?(conn)))

      true ->
        head = List.first(parts) |> String.downcase()

        if MapSet.member?(Door.reserved(), head) or head in ["enter", "login", "setup"] do
          html(conn, 200, Html.render_enter(local: local_client?(conn)))
        else
          phrase = Door.normalize(head)

          if not Door.valid?(phrase) or not Pack.exists?(phrase) do
            html(conn, 404, Html.render_dead_link())
          else
            rest =
              case parts do
                [_] -> "/"
                _ -> "/" <> Enum.join(tl(parts), "/")
              end

            pack_dir = Pack.path_for(phrase)
            Pack.ensure_dirs!(pack_dir)
            base = "/#{phrase}"
            serve_pack(%{conn | request_path: rest, path_info: tl(conn.path_info)}, rest, pack_dir, base, phrase)
          end
        end
    end
  end

  # ---------- helpers ----------

  defp enter(conn) do
    q = conn.query_params || fetch_query(conn)
    phrase = Door.normalize(q["door"] || q["q"] || "")
    local = local_client?(conn)

    cond do
      phrase == "" ->
        html(conn, 200, Html.render_enter(error: "Enter your key to open your notes.", local: local))

      not Config.door_open?() and not Pack.exists?(phrase) ->
        html(conn, 200, Html.render_enter(error: "That key didn’t work. Check the words and try again.", local: local))

      true ->
        redirect(conn, "/#{phrase}/")
    end
  end

  defp fetch_query(conn) do
    conn = Plug.Conn.fetch_query_params(conn)
    conn.query_params
  end

  defp serve_pack(conn, path, pack_dir, base, door \\ "")

  defp serve_pack(conn, path, pack_dir, base, door) do
    conn = Plug.Conn.fetch_query_params(conn)
    path = normalize_path(path)

    # CORS for API
    conn =
      if String.starts_with?(path, "/api") do
        apply_cors(conn)
      else
        conn
      end

    if conn.method == "OPTIONS" and String.starts_with?(path, "/api") do
      send_resp(conn, 204, "")
    else
      route_pack(conn, path, pack_dir, base, door)
    end
  end

  defp route_pack(conn, path, pack_dir, base, door) do
    case {conn.method, path} do
      {"GET", "/"} ->
        html(conn, 200, Html.render_index(pack_dir, door, base))

      {"GET", "/manifest.webmanifest"} ->
        send_json(conn, 200, Html.web_manifest(if(base == "", do: "/", else: base <> "/")))

      {"GET", "/manifest.json"} ->
        send_json(conn, 200, Html.web_manifest(if(base == "", do: "/", else: base <> "/")))

      {"GET", "/api/protocol"} ->
        send_json(conn, 200, protocol_info(door))

      {"GET", "/api/resolve"} ->
        q = conn.query_params["q"] || ""

        if String.trim(q) == "" do
          send_json(conn, 400, %{ok: false, error: "missing q"})
        else
          case Scope.parse(q) do
            nil ->
              send_json(conn, 400, %{ok: false, error: "invalid passage address", q: q})

            scope ->
              send_json(conn, 200, %{
                ok: true,
                q: q,
                scope: %{kind: scope.kind, osis: scope.osis, slug: scope.slug},
                label: Scope.display(scope)
              })
          end
        end

      {"GET", "/api/suggest"} ->
        q = conn.query_params["q"] || ""
        limit = parse_limit(conn.query_params["limit"])
        suggestions = Scope.autocomplete(q, limit)
        send_json(conn, 200, %{q: q, suggestions: suggestions})

      {"GET", "/api/notes"} ->
        t0 = System.monotonic_time(:microsecond)
        notes = Note.list(pack_dir)
        Keyverse.Metrics.record(:http_list_notes, (System.monotonic_time(:microsecond) - t0) / 1000)
        send_json(conn, 200, notes)

      {method, path} ->
        cond do
          # Immutable BSB chapter JSON (public-domain pack in ETS)
          text_api = Regex.run(~r|^/api/text/bsb/([A-Za-z0-9]+)/(\d+)$|, path) ->
            handle_api_text(conn, method, Enum.at(text_api, 1), Enum.at(text_api, 2))

          # Full reader bundle for SPA chapter swaps
          read_api = Regex.run(~r|^/api/read/([a-z0-9.\-]+)$|i, path) ->
            handle_api_read(conn, pack_dir, base, method, Enum.at(read_api, 1))

          true ->
            serve_pack_rest(conn, pack_dir, door, base, method, path)
        end
    end
  end

  # Keep the rest of pack routes in a helper so the text/read APIs can match first.
  defp serve_pack_rest(conn, pack_dir, door, base, method, path) do
    case {method, path} do
      {"GET", "/api/share-qr"} ->
        if Config.door_open?() or door == "" do
          send_resp(conn, 404, "no door")
        else
          origin = conn.query_params["origin"] || public_origin(conn)
          url = String.trim_trailing(origin, "/") <> "/#{door}/"
          svg = qr_svg(url)

          conn
          |> put_resp_content_type("image/svg+xml")
          |> put_resp_header("cache-control", "private, max-age=300")
          |> send_resp(200, svg)
        end

      {"GET", "/api/pack"} ->
        send_json(conn, 200, PackTransfer.manifest(pack_dir))

      {"GET", "/api/pack/export"} ->
        t0 = System.monotonic_time(:microsecond)

        case PackTransfer.export_zip(pack_dir) do
          {:ok, name, bin} ->
            Keyverse.Metrics.record(:http_export, (System.monotonic_time(:microsecond) - t0) / 1000)

            conn
            |> put_resp_content_type("application/zip")
            |> put_resp_header("content-disposition", ~s(attachment; filename="#{name}"))
            |> put_resp_header("cache-control", "no-store")
            |> send_resp(200, bin)

          {:error, reason} ->
            Keyverse.Metrics.record(:http_export, (System.monotonic_time(:microsecond) - t0) / 1000, %{error: true})
            send_json(conn, 400, %{error: to_string(reason)})
        end

      {"POST", "/api/pack/import"} ->
        handle_pack_import(conn, pack_dir)

      {"GET", "/go"} ->
        case Scope.parse(conn.query_params["q"] || "") do
          nil ->
            html(conn, 200, Html.page("keyverse", "<p>Could not parse that passage. <a href=\"#{base}/\">Back</a></p>", base: base))

          scope ->
            loc =
              if scope.kind == "chapter",
                do: "#{base}/read/#{scope.slug}",
                else: "#{base}/note/#{scope.slug}"

            redirect(conn, loc)
        end

      {method, path} ->
        cond do
          note_page = Regex.run(~r|^/note/([a-z0-9.\-]+)$|i, path) ->
            handle_note_page(conn, pack_dir, base, Enum.at(note_page, 1))

          read_page = Regex.run(~r|^/read/([a-z0-9.\-]+)$|i, path) ->
            handle_read_page(conn, pack_dir, base, Enum.at(read_page, 1))

          api_note = Regex.run(~r|^/api/note/([a-z0-9.\-]+)$|i, path) ->
            handle_api_note(conn, pack_dir, method, Enum.at(api_note, 1))

          api_att = Regex.run(~r|^/api/note/([a-z0-9.\-]+)/attachments$|i, path) ->
            handle_api_attach(conn, pack_dir, method, Enum.at(api_att, 1))

          api_del = Regex.run(~r|^/api/note/([a-z0-9.\-]+)/attachments/([^/]+)$|i, path) ->
            handle_api_detach(conn, pack_dir, method, Enum.at(api_del, 1), Enum.at(api_del, 2))

          api_blob = Regex.run(~r|^/api/attachments/([a-f0-9]{64})$|i, path) ->
            handle_api_blob(conn, pack_dir, Enum.at(api_blob, 1))

          true ->
            send_json(conn, 404, %{error: "not found"})
        end
    end
  end

  defp handle_api_text(conn, "GET", book, chapter_s) do
    t0 = System.monotonic_time(:microsecond)
    book = String.upcase(book)

    result =
      case Integer.parse(chapter_s) do
        {ch, ""} when ch > 0 ->
          case Keyverse.TextCache.get_chapter(book, ch) do
            {:ok, doc} ->
              body = Jason.encode!(doc)
              etag = ~s("#{Base.encode16(:crypto.hash(:sha256, body), case: :lower) |> binary_part(0, 16)}")

              conn
              |> put_resp_content_type("application/json")
              |> put_resp_header("cache-control", "public, max-age=31536000, immutable")
              |> put_resp_header("etag", etag)
              |> put_resp_header("x-keyverse-text", "bsb-pack")
              |> send_resp(200, body <> "\n")

            {:error, reason} ->
              send_json(conn, 404, %{error: to_string(reason), book: book, chapter: ch})
          end

        _ ->
          send_json(conn, 400, %{error: "invalid chapter"})
      end

    Keyverse.Metrics.record(:http_text, (System.monotonic_time(:microsecond) - t0) / 1000)
    result
  end

  defp handle_api_text(conn, _, _, _), do: send_json(conn, 405, %{error: "method not allowed"})

  defp handle_api_read(conn, pack_dir, base, "GET", slug) do
    t0 = System.monotonic_time(:microsecond)

    result =
      case Scope.parse(slug) do
        nil ->
          send_json(conn, 400, %{error: "invalid passage address"})

        scope ->
          # Normalize to chapter scope for navigation bundle
          ch_scope = Scope.parse("#{scope.parsed.book}.#{scope.parsed.chapter}") || scope

          case Html.build_read_bundle(pack_dir, scope, base) do
            {:ok, bundle} ->
              send_json(conn, 200, %{
                ok: true,
                meta: bundle.meta,
                seed: bundle.seed,
                text: bundle.text,
                html: bundle.html,
                canonical_slug: ch_scope.slug
              })

            {:error, reason} ->
              send_json(conn, 404, %{ok: false, error: to_string(reason)})
          end
      end

    Keyverse.Metrics.record(:http_read_bundle, (System.monotonic_time(:microsecond) - t0) / 1000)
    result
  end

  defp handle_api_read(conn, _, _, _, _), do: send_json(conn, 405, %{error: "method not allowed"})

  defp handle_note_page(conn, pack_dir, base, slug) do
    case Scope.parse(slug) do
      nil ->
        html(conn, 404, Html.page("not found", "<p>Not a valid passage address. <a href=\"#{base}/\">Back</a></p>", base: base))

      scope ->
        if scope.slug != slug do
          redirect(conn, "#{base}/note/#{scope.slug}")
        else
          html(conn, 200, Html.render_editor(pack_dir, scope, base))
        end
    end
  end

  defp handle_read_page(conn, pack_dir, base, slug) do
    case Scope.parse(slug) do
      nil ->
        html(conn, 404, Html.page("not found", "<p>Not a valid passage address. <a href=\"#{base}/\">Back</a></p>", base: base))

      scope ->
        if scope.slug != slug do
          redirect(conn, "#{base}/read/#{scope.slug}")
        else
          html(conn, 200, Html.render_read(pack_dir, scope, base))
        end
    end
  end

  defp handle_api_note(conn, pack_dir, "GET", slug) do
    t0 = System.monotonic_time(:microsecond)

    result =
      case Scope.parse(slug) do
        nil ->
          send_json(conn, 400, %{error: "invalid passage address"})

        scope ->
          note = Note.read(pack_dir, scope.slug)

          cond do
            is_nil(note) ->
              send_json(conn, 404, %{error: "no note at this address"})

            raw_request?(conn) and Note.encrypted?(note) ->
              send_json(conn, 409, %{error: "encrypted", message: "note is encrypted; raw plaintext unavailable"})

            raw_request?(conn) ->
              conn
              |> put_resp_content_type("text/plain")
              |> send_resp(200, Note.serialize_blocks(note["blocks"] || []) <> "\n")

            true ->
              send_json(conn, 200, note)
          end
      end

    Keyverse.Metrics.record(:http_get_note, (System.monotonic_time(:microsecond) - t0) / 1000)
    result
  end

  defp handle_api_note(conn, pack_dir, "PUT", slug) do
    t0 = System.monotonic_time(:microsecond)

    result =
      case Scope.parse(slug) do
        nil ->
          send_json(conn, 400, %{error: "invalid passage address"})

        scope ->
          ct = conn |> get_req_header("content-type") |> List.first() |> to_string() |> String.downcase()

          result =
            if String.contains?(ct, "application/json") or is_map(conn.body_params) and conn.body_params != %{} do
              parsed = if is_map(conn.body_params) and map_size(conn.body_params) > 0 do
                conn.body_params
              else
                {:ok, body, _conn} = Plug.Conn.read_body(conn, length: Config.max_attach_bytes())
                case Jason.decode(body) do
                  {:ok, p} -> p
                  _ -> %{}
                end
              end

              case parsed do
                %{"encrypted" => true, "cipher" => cipher} ->
                  Note.put_note(pack_dir, scope, %{encrypted: true, cipher: cipher})

                %{} = p when map_size(p) == 0 ->
                  {:error, "invalid json"}

                parsed ->
                  Note.put_note(pack_dir, scope, parsed)
              end
            else
              {:ok, body, conn} = Plug.Conn.read_body(conn, length: Config.max_attach_bytes())
              _ = conn
              blocks = Note.parse_interchange_text(body)
              Note.put_note(pack_dir, scope, %{"blocks" => blocks})
            end

          case result do
            {:deleted, true} -> send_json(conn, 200, %{deleted: true})
            {:ok, note} -> send_json(conn, 200, note)
            note when is_map(note) -> send_json(conn, 200, note)
            {:error, msg} -> send_json(conn, 400, %{error: msg})
          end
      end

    err = is_struct(result, Plug.Conn) and result.status >= 400
    Keyverse.Metrics.record(:http_put_note, (System.monotonic_time(:microsecond) - t0) / 1000, %{error: err})
    result
  end

  defp handle_api_note(conn, _pack_dir, _, _slug) do
    send_json(conn, 405, %{error: "method not allowed"})
  end

  defp handle_pack_import(conn, pack_dir) do
    t0 = System.monotonic_time(:microsecond)
    conn = Plug.Conn.fetch_query_params(conn)
    mode = if conn.query_params["mode"] == "replace", do: :replace, else: :merge

    zip_bin =
      cond do
        is_map(conn.body_params) and is_map(conn.body_params["pack"]) ->
          upload = conn.body_params["pack"]

          cond do
            is_struct(upload, Plug.Upload) ->
              File.read!(upload.path)

            is_map(upload) and is_binary(upload["path"]) ->
              File.read!(upload["path"])

            true ->
              nil
          end

        true ->
          case Plug.Conn.read_body(conn, length: Config.max_attach_bytes()) do
            {:ok, body, _conn} when byte_size(body) > 0 -> body
            _ -> nil
          end
      end

    result =
      cond do
        is_nil(zip_bin) or zip_bin == "" ->
          send_json(conn, 400, %{error: "missing pack zip (multipart field pack or raw body)"})

        true ->
          case PackTransfer.import_zip(pack_dir, zip_bin, mode: mode, validate: true) do
            {:ok, info} ->
              send_json(conn, 200, %{
                ok: true,
                mode: info.mode,
                files: info.files,
                manifest: PackTransfer.manifest(pack_dir)
              })

            {:error, {:conformance_failed, report}} ->
              send_json(conn, 422, %{
                ok: false,
                error: "conformance_failed",
                errors: report.errors
              })

            {:error, reason} ->
              send_json(conn, 400, %{ok: false, error: to_string(reason)})
          end
      end

    err = is_struct(result, Plug.Conn) and result.status >= 400
    Keyverse.Metrics.record(:http_import, (System.monotonic_time(:microsecond) - t0) / 1000, %{error: err})
    result
  end

  defp handle_api_attach(conn, pack_dir, "POST", slug) do
    case Scope.parse(slug) do
      nil ->
        send_json(conn, 400, %{error: "invalid passage address"})

      scope ->
        ct = conn |> get_req_header("content-type") |> List.first() |> to_string() |> String.downcase()
        existing = Note.read(pack_dir, scope.slug)

        cond do
          String.contains?(ct, "application/json") or
              (is_map(conn.body_params) and Map.has_key?(conn.body_params, "kind")) ->
            parsed =
              if is_map(conn.body_params) and map_size(conn.body_params) > 0 do
                conn.body_params
              else
                {:ok, body, _} = Plug.Conn.read_body(conn, length: Config.max_attach_bytes())

                case Jason.decode(body) do
                  {:ok, p} -> p
                  _ -> %{}
                end
              end

            case parsed do
              %{"kind" => "url", "url" => url} = p ->
                att = %{
                  "id" => Note.new_att_id(),
                  "kind" => "url",
                  "url" => url,
                  "title" => p["title"],
                  "created_at" => Note.iso_now()
                }

                attach_to_note(conn, pack_dir, scope, existing, att)

              _ ->
                send_json(conn, 400, %{error: "invalid attachment json"})
            end

          true ->
            {:ok, body, conn} = Plug.Conn.read_body(conn, length: Config.max_attach_bytes())

            filename =
              conn
              |> get_req_header("x-filename")
              |> List.first()
              |> case do
                nil -> "file"
                f -> f
              end

            mime = if ct == "", do: "application/octet-stream", else: ct
            sha = Note.write_attachment_blob!(pack_dir, body)

            att = %{
              "id" => Note.new_att_id(),
              "kind" => "file",
              "name" => filename,
              "mime" => mime,
              "sha256" => sha,
              "bytes" => byte_size(body),
              "created_at" => Note.iso_now()
            }

            if existing && Note.encrypted?(existing) do
              send_json(conn, 200, %{encrypted: true, attachment: att})
            else
              attach_to_note(conn, pack_dir, scope, existing, att)
            end
        end
    end
  end

  defp handle_api_attach(conn, _, _, _) do
    send_json(conn, 405, %{error: "method not allowed"})
  end

  defp attach_to_note(conn, pack_dir, scope, existing, att) do
    if existing && Note.encrypted?(existing) do
      send_json(conn, 200, %{encrypted: true, attachment: att})
    else
      now = Note.iso_now()
      blocks = (existing && existing["blocks"]) || []
      atts = ((existing && existing["attachments"]) || []) ++ [att]

      note = %{
        "id" => (existing && existing["id"]) || Note.new_id(),
        "scope" => Note.scope_map(scope),
        "blocks" => blocks,
        "attachments" => atts,
        "created_at" => (existing && existing["created_at"]) || now,
        "updated_at" => now
      }

      Note.write!(pack_dir, note)
      send_json(conn, 200, note)
    end
  end

  defp handle_api_detach(conn, pack_dir, "DELETE", slug, att_id) do
    case Scope.parse(slug) do
      nil ->
        send_json(conn, 400, %{error: "invalid passage address"})

      scope ->
        note = Note.read(pack_dir, scope.slug)

        cond do
          is_nil(note) ->
            send_json(conn, 404, %{error: "no note at this address"})

          Note.encrypted?(note) ->
            sha = conn.query_params["sha256"]

            if sha && Regex.match?(~r/^[a-f0-9]{64}$/i, sha) do
              unless Note.attachment_referenced?(pack_dir, String.downcase(sha)) do
                path = Note.attach_blob_path(pack_dir, sha)
                if path, do: File.rm(path)
              end
            end

            send_json(conn, 200, %{encrypted: true, removed: att_id})

          true ->
            removed = Enum.find(note["attachments"] || [], &(&1["id"] == att_id))
            atts = Enum.reject(note["attachments"] || [], &(&1["id"] == att_id))
            note = note |> Map.put("attachments", atts) |> Map.put("updated_at", Note.iso_now())
            Note.write!(pack_dir, note)

            if removed && removed["kind"] == "file" && removed["sha256"] do
              unless Note.attachment_referenced?(pack_dir, removed["sha256"]) do
                path = Note.attach_blob_path(pack_dir, removed["sha256"])
                if path, do: File.rm(path)
              end
            end

            send_json(conn, 200, note)
        end
    end
  end

  defp handle_api_detach(conn, _, _, _, _) do
    send_json(conn, 405, %{error: "method not allowed"})
  end

  defp handle_api_blob(conn, pack_dir, sha) do
    sha = String.downcase(sha)
    path = Note.attach_blob_path(pack_dir, sha)

    case path && File.read(path) do
      {:ok, bin} ->
        {mime, name} =
          Enum.find_value(Note.list(pack_dir), {"application/octet-stream", "file"}, fn n ->
            case Enum.find(n["attachments"] || [], &(&1["kind"] == "file" and &1["sha256"] == sha)) do
              nil -> nil
              a -> {a["mime"] || "application/octet-stream", a["name"] || "file"}
            end
          end)

        name = conn.query_params["name"] || name

        conn
        |> put_resp_content_type(mime)
        |> put_resp_header("content-disposition", ~s(inline; filename="#{String.replace(name, "\"", "")}"))
        |> put_resp_header("cache-control", "public, max-age=31536000, immutable")
        |> send_resp(200, bin)

      _ ->
        send_json(conn, 404, %{error: "attachment not found"})
    end
  end

  defp raw_request?(conn) do
    Map.has_key?(conn.query_params, "raw") or
      (conn |> get_req_header("accept") |> List.first() || "") |> String.contains?("text/plain")
  end

  defp parse_limit(nil), do: 8

  defp parse_limit(s) do
    case Integer.parse(to_string(s)) do
      {n, _} -> n |> max(1) |> min(20)
      _ -> 8
    end
  end

  defp protocol_info(door) do
    %{
      protocol: Config.protocol_name(),
      version: Config.protocol_version(),
      app_version: Config.app_version(),
      multipack: not Config.door_open?(),
      door: not Config.door_open?() and door != "",
      door_phrase: if(door == "", do: nil, else: door),
      door_open: Config.door_open?(),
      cors: not cors_disabled?(),
      max_attach_bytes: Config.max_attach_bytes(),
      features: %{
        notes: true,
        attachments: true,
        encryption: true,
        suggest: true,
        resolve: true,
        share_qr: not Config.door_open?() and door != "",
        multipack: not Config.door_open?(),
        pack_export: true,
        pack_import: true,
        pack_writers: true,
        metrics: true,
        pwa: true,
        local_fs_mount_ro: true,
        host: "elixir"
      },
      endpoints: [
        "GET /api/protocol",
        "GET /api/notes",
        "GET /api/resolve?q=",
        "GET /api/suggest?q=&limit=",
        "GET /api/text/bsb/<book>/<chapter>",
        "GET /api/read/<slug>",
        "GET /api/note/<slug>",
        "GET /api/note/<slug>?raw",
        "PUT /api/note/<slug>",
        "POST /api/note/<slug>/attachments",
        "DELETE /api/note/<slug>/attachments/<att_id>",
        "GET /api/attachments/<sha256>",
        "GET /api/pack",
        "GET /api/pack/export",
        "POST /api/pack/import",
        "GET /api/share-qr?origin=",
        "GET /local",
        "GET /metrics",
        "GET /manifest.webmanifest",
        "GET /sw.js",
        "GET /offline",
        "GET /health"
      ],
      ownership: %{
        user_owned_pack: true,
        source_of_truth: "filesystem pack directory",
        export: "GET /api/pack/export",
        import: "POST /api/pack/import?mode=merge|replace",
        local_mount: "GET /local (browser directory / OPFS, read-only)"
      },
      scaling: %{
        pack_write_queue: "per-pack GenServer",
        replicas: "single-writer per pack; sticky door routing required for multi-replica",
        see: "docs/SCALING.md"
      },
      schemas: "schemas/",
      docs: %{
        protocol: "PROTOCOL.md",
        http: "docs/API.md",
        ownership: "docs/OWNERSHIP.md",
        llms: "llms.txt"
      }
    }
  end

  defp health(conn) do
    t0 = System.monotonic_time(:microsecond)
    summary = Keyverse.Metrics.health_summary()

    body =
      Jason.encode!(%{
        ok: true,
        protocol: Config.protocol_name(),
        version: Config.protocol_version(),
        app_version: Config.app_version(),
        multipack: not Config.door_open?(),
        door_open: Config.door_open?(),
        packs_root: Config.packs_root(),
        host: "elixir",
        metrics: summary
      })

    Keyverse.Metrics.record(:http_health, (System.monotonic_time(:microsecond) - t0) / 1000)

    conn
    |> put_resp_content_type("application/json")
    |> put_resp_header("cache-control", "no-store")
    |> send_resp(200, body <> "\n")
  end

  defp metrics(conn) do
    body = Jason.encode!(Keyverse.Metrics.snapshot(), pretty: true)

    conn
    |> put_resp_content_type("application/json")
    |> put_resp_header("cache-control", "no-store")
    |> send_resp(200, body <> "\n")
  end

  defp normalize_path(""), do: "/"
  defp normalize_path(nil), do: "/"

  defp normalize_path(p) do
    p = if String.starts_with?(p, "/"), do: p, else: "/" <> p
    if p != "/" and String.ends_with?(p, "/"), do: String.trim_trailing(p, "/"), else: p
  end

  defp html(conn, code, body) do
    conn
    |> put_resp_content_type("text/html")
    |> send_resp(code, body)
  end

  defp send_json(conn, code, obj) do
    body = Jason.encode!(obj, pretty: true)

    conn
    |> put_resp_content_type("application/json")
    |> send_resp(code, body <> "\n")
  end

  defp redirect(conn, loc) do
    conn
    |> put_resp_header("location", loc)
    |> put_resp_header("cache-control", "no-store")
    |> send_resp(302, "")
  end

  defp send_static(conn, rel, content_type, cache) do
    path = Path.join(Config.static_dir(), rel)

    case File.read(path) do
      {:ok, body} ->
        conn
        |> put_resp_content_type(content_type)
        |> put_resp_header("cache-control", cache)
        |> send_resp(200, body)

      _ ->
        send_resp(conn, 404, "not found")
    end
  end

  defp mime_for(path) do
    cond do
      String.ends_with?(path, ".png") -> "image/png"
      String.ends_with?(path, ".svg") -> "image/svg+xml"
      String.ends_with?(path, ".js") -> "application/javascript"
      String.ends_with?(path, ".css") -> "text/css"
      true -> "application/octet-stream"
    end
  end

  defp local_client?(conn) do
    peer = conn.remote_ip

    case peer do
      {127, 0, 0, 1} -> true
      {0, 0, 0, 0, 0, 0, 0, 1} -> true
      _ -> false
    end
  end

  defp cors_disabled? do
    v = Config.cors_origin()
    v in ["off", "0", "false", "no"]
  end

  defp apply_cors(conn) do
    if cors_disabled?() do
      conn
    else
      conf = Config.cors_origin()
      conf = if conf in [nil, ""], do: "*", else: String.trim(conf)

      allow =
        if conf == "*" do
          "*"
        else
          allowed = conf |> String.split(",") |> Enum.map(&String.trim/1) |> Enum.reject(&(&1 == ""))
          origin = conn |> get_req_header("origin") |> List.first()

          cond do
            origin && origin in allowed -> origin
            allowed != [] -> hd(allowed)
            true -> "*"
          end
        end

      conn
      |> put_resp_header("access-control-allow-origin", allow)
      |> put_resp_header("access-control-allow-methods", "GET, PUT, POST, DELETE, OPTIONS")
      |> put_resp_header("access-control-allow-headers", "content-type, x-filename, accept")
      |> put_resp_header("access-control-max-age", "86400")
      |> put_resp_header(
        "access-control-expose-headers",
        "content-type, content-disposition, content-length"
      )
    end
  end

  defp public_origin(conn) do
    proto =
      case get_req_header(conn, "x-forwarded-proto") do
        [p | _] -> p |> String.split(",") |> hd() |> String.trim()
        _ -> "http"
      end

    host =
      case get_req_header(conn, "x-forwarded-host") do
        [h | _] -> h |> String.split(",") |> hd() |> String.trim()
        _ ->
          case get_req_header(conn, "host") do
            [h | _] -> h
            _ -> "localhost:#{Config.port()}"
          end
      end

    "#{proto}://#{host}"
  end

  defp qr_svg(text) do
    text
    |> EQRCode.encode()
    |> EQRCode.svg(width: 200)
  end
end
