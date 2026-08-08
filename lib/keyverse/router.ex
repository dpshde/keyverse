defmodule Keyverse.Router do
  @moduledoc "HTTP multipack door — Plug router."
  use Plug.Router

  alias Keyverse.{
    Activity,
    Attach,
    Config,
    Door,
    DoorIndex,
    Html,
    Note,
    Pack,
    PackQuota,
    PackTransfer,
    RateLimit,
    Scope
  }

  plug Plug.Parsers,
    parsers: [:urlencoded, :multipart, :json],
    pass: ["*/*"],
    json_decoder: Jason,
    length: 52_428_800,
    read_length: 1_048_576,
    read_timeout: 60_000

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

  get "/platform.js" do
    send_static(conn, "platform.js", "application/javascript", "public, max-age=3600")
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

  get "/activity.js" do
    send_static(conn, "activity.js", "application/javascript", "public, max-age=3600")
  end

  get "/door-share.js" do
    send_static(conn, "door-share.js", "application/javascript", "public, max-age=3600")
  end

  get "/passage-share.js" do
    send_static(conn, "passage-share.js", "application/javascript", "public, max-age=3600")
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

  # Public (no-door) scripture routes for route.bible weblinks and share targets.
  # Uses a shared read-only pack so BSB reader works without claiming a key.
  get "/go" do
    public_go(conn)
  end

  get "/read/*path" do
    slug = path |> List.wrap() |> Enum.join("/")
    public_read_page(conn, slug)
  end

  get "/api/text/bsb/:book/:chapter" do
    handle_api_text(conn, "GET", book, chapter)
  end

  get "/api/read/:slug" do
    handle_api_read(conn, public_pack_dir(), "", "GET", slug)
  end

  # Raw Markdown: full chapter BSB + notes (public pack → notes usually empty)
  get "/api/md/:slug" do
    handle_api_md(conn, public_pack_dir(), "GET", slug)
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
      case enforce_rates(conn, [{:setup_ip, Config.rate_setup()}]) do
        {:halt, conn} ->
          conn

        :ok ->
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

          case DoorIndex.resolve(phrase) do
            {:ok, %{pack_dir: pack_dir, pack_id: pack_id, role: role, phrase: phrase}} ->
              rest =
                case parts do
                  [_] -> "/"
                  _ -> "/" <> Enum.join(tl(parts), "/")
                end

              Pack.ensure_dirs!(pack_dir, pack_id: pack_id)
              base = "/#{phrase}"

              serve_pack(
                %{conn | request_path: rest, path_info: tl(conn.path_info)},
                rest,
                pack_dir,
                base,
                phrase,
                %{pack_id: pack_id, role: role}
              )

            :error ->
              html(conn, 404, Html.render_dead_link())
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

  defp public_pack_dir do
    dir = Path.join(Config.packs_root(), "_public")
    Pack.ensure_dirs!(dir, pack_id: "public")
    dir
  end

  defp public_go(conn) do
    conn = Plug.Conn.fetch_query_params(conn)

    case Scope.parse(conn.query_params["q"] || "") do
      nil ->
        html(
          conn,
          200,
          Html.page(
            "keyverse",
            "<p>Could not parse that passage. <a href=\"/\">Back</a> · <a href=\"/local\">Open notes on this device</a></p>",
            base: ""
          )
        )

      scope ->
        # Always land on the reader for public handoff (notes require a personal key).
        redirect(conn, "/read/#{scope.slug}")
    end
  end

  defp public_read_page(conn, slug) do
    slug = slug |> to_string() |> String.trim() |> URI.decode()

    case Scope.parse(slug) do
      nil ->
        html(
          conn,
          404,
          Html.page(
            "not found",
            "<p>Not a valid passage address. <a href=\"/\">Back</a></p>",
            base: ""
          )
        )

      scope ->
        if scope.slug != slug do
          redirect(conn, "/read/#{scope.slug}")
        else
          html(conn, 200, Html.render_read(public_pack_dir(), scope, ""))
        end
    end
  end

  defp serve_pack(conn, path, pack_dir, base, door \\ "", access \\ %{})

  defp serve_pack(conn, path, pack_dir, base, door, access) do
    conn = Plug.Conn.fetch_query_params(conn)
    path = normalize_path(path)

    access =
      Map.merge(%{role: "write", pack_id: Pack.read_pack_id(pack_dir)}, access || %{})

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
      route_pack(conn, path, pack_dir, base, door, access)
    end
  end

  defp route_pack(conn, path, pack_dir, base, door, access) do
    case {conn.method, path} do
      {"GET", "/"} ->
        html(conn, 200, Html.render_index(pack_dir, door, base))

      {"GET", "/activity"} ->
        html(conn, 200, Html.render_activity(base, door))

      {"GET", "/manifest.webmanifest"} ->
        send_json(conn, 200, Html.web_manifest(if(base == "", do: "/", else: base <> "/")))

      {"GET", "/manifest.json"} ->
        send_json(conn, 200, Html.web_manifest(if(base == "", do: "/", else: base <> "/")))

      {"GET", "/api/protocol"} ->
        send_json(conn, 200, protocol_info(door, access))

      {"GET", "/api/door"} ->
        send_json(conn, 200, %{
          ok: true,
          door: door,
          pack_id: access[:pack_id] || access["pack_id"],
          role: access[:role] || access["role"] || "write"
        })

      {"POST", "/api/door/rotate"} ->
        require_write(conn, access, fn ->
          pack_id = access[:pack_id] || access["pack_id"] || Pack.read_pack_id(pack_dir)

          case DoorIndex.rotate(pack_id, door) do
            {:ok, %{door: new_door, pack_id: pid}} ->
              send_json(conn, 200, %{
                ok: true,
                door: new_door,
                pack_id: pid,
                message: "key rotated — update bookmarks to the new URL",
                url_path: "/#{new_door}/"
              })

            {:error, reason} ->
              send_json(conn, 400, %{ok: false, error: to_string(reason)})
          end
        end)

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
          text_api = Regex.run(~r|^/api/text/bsb/([A-Za-z0-9]+)/(\d+)$|, path) ->
            handle_api_text(conn, method, Enum.at(text_api, 1), Enum.at(text_api, 2))

          read_api = Regex.run(~r|^/api/read/([a-z0-9.\-]+)$|i, path) ->
            handle_api_read(conn, pack_dir, base, method, Enum.at(read_api, 1))

          # Accept heb.8 / heb.8.md / heb.8.12 (verse expands to full chapter)
          md_api = Regex.run(~r|^/api/md/([a-z0-9.\-]+?)(?:\.md)?$|i, path) ->
            handle_api_md(conn, pack_dir, method, Enum.at(md_api, 1))

          true ->
            serve_pack_rest(conn, pack_dir, door, base, method, path, access)
        end
    end
  end

  # Keep the rest of pack routes in a helper so the text/read APIs can match first.
  defp serve_pack_rest(conn, pack_dir, door, base, method, path, access) do
    write? = write_role?(access)

    case {method, path} do
      {"GET", "/api/share-qr"} ->
        if Config.door_open?() or door == "" do
          send_resp(conn, 404, "no door")
        else
          origin = conn.query_params["origin"] || public_origin(conn)
          path = normalize_share_path(conn.query_params["path"])

          if is_nil(path) do
            send_json(conn, 400, %{error: "invalid path"})
          else
            base = String.trim_trailing(origin, "/") <> "/#{door}"
            url = if path == "/", do: base <> "/", else: base <> path
            svg = qr_svg(url)

            conn
            |> put_resp_content_type("image/svg+xml")
            |> put_resp_header("cache-control", "private, max-age=300")
            |> send_resp(200, svg)
          end
        end

      {"GET", "/api/pack"} ->
        man = PackTransfer.manifest(pack_dir)
        quota = PackQuota.usage(pack_dir)
        send_json(conn, 200, Map.put(man, :quota, quota))

      {"GET", "/api/activity"} ->
        conn = Plug.Conn.fetch_query_params(conn)

        case conn.query_params["date"] do
          date when is_binary(date) and date != "" ->
            case Activity.day(pack_dir, date) do
              {:error, :invalid_date} ->
                send_json(conn, 400, %{error: "invalid date (use YYYY-MM-DD)"})

              detail ->
                send_json(conn, 200, detail)
            end

          _ ->
            # Default graph window = YTD. Optional days=N for trailing window.
            opts =
              case conn.query_params["days"] do
                nil -> []
                "" -> []
                d -> [days: parse_activity_days(d)]
              end

            send_json(conn, 200, Activity.heatmap(pack_dir, opts))
        end

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
        require_write(conn, access, fn -> handle_pack_import(conn, pack_dir) end)

      {"GET", "/go"} ->
        case Scope.parse(conn.query_params["q"] || "") do
          nil ->
            html(conn, 200, Html.page("keyverse", "<p>Could not parse that passage. <a href=\"#{base}/\">Back</a></p>", base: base))

          scope ->
            # Always projected reader (ADR 0019). Verse/range deep-links highlight
            # and expand notes when present (reader applyHighlightFromDom).
            redirect(conn, "#{base}/read/#{scope.slug}")
        end

      {method, path} ->
        cond do
          note_page = Regex.run(~r|^/note/([a-z0-9.\-]+)$|i, path) ->
            handle_note_page(conn, pack_dir, base, Enum.at(note_page, 1))

          read_page = Regex.run(~r|^/read/([a-z0-9.\-]+)$|i, path) ->
            handle_read_page(conn, pack_dir, base, Enum.at(read_page, 1))

          api_note = Regex.run(~r|^/api/note/([a-z0-9.\-]+)$|i, path) ->
            if method in ["PUT", "POST", "DELETE", "PATCH"] and not write? do
              forbid_write(conn)
            else
              handle_api_note(conn, pack_dir, method, Enum.at(api_note, 1))
            end

          api_att = Regex.run(~r|^/api/note/([a-z0-9.\-]+)/attachments$|i, path) ->
            if method in ["PUT", "POST", "DELETE", "PATCH"] and not write? do
              forbid_write(conn)
            else
              handle_api_attach(conn, pack_dir, method, Enum.at(api_att, 1))
            end

          api_del = Regex.run(~r|^/api/note/([a-z0-9.\-]+)/attachments/([^/]+)$|i, path) ->
            if method in ["PUT", "POST", "DELETE", "PATCH"] and not write? do
              forbid_write(conn)
            else
              handle_api_detach(conn, pack_dir, method, Enum.at(api_del, 1), Enum.at(api_del, 2))
            end

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

  defp handle_api_md(conn, pack_dir, "GET", slug) do
    t0 = System.monotonic_time(:microsecond)
    slug = slug |> to_string() |> String.trim_trailing(".md")

    result =
      case Keyverse.ChapterMd.render(pack_dir, slug) do
        {:ok, md} ->
          conn
          |> put_resp_content_type("text/markdown")
          |> put_resp_header("cache-control", "private, max-age=60")
          |> put_resp_header("x-keyverse-md", "chapter")
          |> send_resp(200, md)

        {:error, :invalid_address} ->
          send_resp_plain(conn, 400, "invalid passage address\n")

        {:error, reason} ->
          send_resp_plain(conn, 404, "#{reason}\n")
      end

    Keyverse.Metrics.record(:http_chapter_md, (System.monotonic_time(:microsecond) - t0) / 1000)
    result
  end

  defp handle_api_md(conn, _, _, _), do: send_resp_plain(conn, 405, "method not allowed\n")

  defp send_resp_plain(conn, status, body) do
    conn
    |> put_resp_content_type("text/plain")
    |> send_resp(status, body)
  end

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
    door = pack_door(pack_dir)

    result =
      case enforce_rates(conn, [
             {:global_write, Config.rate_global_write()},
             {{:put, door}, Config.rate_put_note()}
           ]) do
        {:halt, conn} ->
          conn

        :ok ->
          do_handle_api_note_put(conn, pack_dir, slug)
      end

    err = is_struct(result, Plug.Conn) and result.status >= 400
    Keyverse.Metrics.record(:http_put_note, (System.monotonic_time(:microsecond) - t0) / 1000, %{error: err})
    result
  end

  defp handle_api_note(conn, _pack_dir, _, _slug) do
    send_json(conn, 405, %{error: "method not allowed"})
  end

  defp do_handle_api_note_put(conn, pack_dir, slug) do
    case Scope.parse(slug) do
      nil ->
        send_json(conn, 400, %{error: "invalid passage address"})

      scope ->
        # 1) Optimistic concurrency (optional base stamp)
        # 2) Anti-stomp: refuse severe content shrink unless X-KV-Allow-Shrink: 1
        #    (protects door from old mobile quietSync that still push-all)
        case check_note_base_updated_at(conn, pack_dir, slug) do
          {:conflict, current} ->
            send_json(conn, 409, %{
              error: "conflict",
              message: "note changed on door since base; pull current and retry",
              base: note_base_header(conn),
              current: current
            })

          :ok ->
            do_handle_api_note_put_body(conn, pack_dir, scope, slug)
        end
    end
  end

  defp do_handle_api_note_put_body(conn, pack_dir, scope, slug) do
    ct = conn |> get_req_header("content-type") |> List.first() |> to_string() |> String.downcase()

    {payload_kind, parsed_or_blocks} =
      if String.contains?(ct, "application/json") or
           (is_map(conn.body_params) and conn.body_params != %{}) do
        parsed =
          if is_map(conn.body_params) and map_size(conn.body_params) > 0 do
            conn.body_params
          else
            {:ok, body, _conn} = Plug.Conn.read_body(conn, length: Config.max_attach_bytes())

            case Jason.decode(body) do
              {:ok, p} -> p
              _ -> %{}
            end
          end

        {:json, parsed}
      else
        {:ok, body, _conn} = Plug.Conn.read_body(conn, length: Config.max_attach_bytes())
        blocks = Note.parse_interchange_text(body)
        {:text, blocks}
      end

    existing = Note.read(pack_dir, slug)

    case maybe_reject_shrink(conn, existing, payload_kind, parsed_or_blocks) do
      {:reject, current, reason} ->
        send_json(conn, 409, %{
          error: "shrink_rejected",
          message: reason,
          current: current
        })

      :ok ->
        result =
          case {payload_kind, parsed_or_blocks} do
            {:json, %{"encrypted" => true, "cipher" => cipher}} ->
              Note.put_note(pack_dir, scope, %{encrypted: true, cipher: cipher})

            {:json, %{} = p} when map_size(p) == 0 ->
              {:error, "invalid json"}

            {:json, parsed} ->
              Note.put_note(pack_dir, scope, parsed)

            {:text, blocks} ->
              Note.put_note(pack_dir, scope, %{"blocks" => blocks})
          end

        case result do
          {:deleted, true} -> send_json(conn, 200, %{deleted: true})
          {:ok, note} -> send_json(conn, 200, note)
          note when is_map(note) -> send_json(conn, 200, note)
          {:error, msg} -> send_json(conn, 400, %{error: msg})
        end
    end
  end

  defp allow_shrink?(conn) do
    conn
    |> get_req_header("x-kv-allow-shrink")
    |> List.first()
    |> case do
      v when v in ["1", "true", "yes"] -> true
      _ -> false
    end
  end

  defp maybe_reject_shrink(conn, existing, payload_kind, parsed_or_blocks) do
    cond do
      is_nil(existing) ->
        :ok

      allow_shrink?(conn) ->
        :ok

      true ->
        {incoming, explicit_delete?} =
          case payload_kind do
            :json ->
              {Keyverse.NoteGuard.score_payload(parsed_or_blocks),
               Keyverse.NoteGuard.explicit_delete_payload?(parsed_or_blocks)}

            :text ->
              {Keyverse.NoteGuard.score_payload(parsed_or_blocks),
               Keyverse.NoteGuard.score_payload(parsed_or_blocks).empty}
          end

        if Keyverse.NoteGuard.destructive_shrink?(existing, incoming,
             explicit_delete?: explicit_delete?
           ) do
          {:reject, existing,
           "refusing to shrink note content; pull current or send X-KV-Allow-Shrink: 1 for intentional edit"}
        else
          :ok
        end
    end
  end

  defp note_base_header(conn) do
    conn
    |> get_req_header("x-kv-base-updated-at")
    |> List.first()
    |> case do
      nil -> nil
      "" -> nil
      v -> String.trim(v)
    end
  end

  # When the client sends a base stamp and the on-disk note is *strictly newer*,
  # reject the write so a stale push cannot wipe concurrent web edits.
  # Missing header → legacy clients, unconditional put (mobile always sends base when known).
  # Base matches or is empty and note missing → ok.
  defp check_note_base_updated_at(conn, pack_dir, slug) do
    case note_base_header(conn) do
      nil ->
        :ok

      base ->
        case Note.read(pack_dir, slug) do
          nil ->
            :ok

          current when is_map(current) ->
            cur = to_string(current["updated_at"] || "")

            cond do
              cur == "" -> :ok
              # Door is ahead of the writer's base → conflict
              cur > base -> {:conflict, current}
              true -> :ok
            end
        end
    end
  end

  defp handle_pack_import(conn, pack_dir) do
    t0 = System.monotonic_time(:microsecond)
    door = pack_door(pack_dir)

    result =
      case enforce_rates(conn, [
             {:global_write, Config.rate_global_write()},
             {{:import, door}, Config.rate_import()}
           ]) do
        {:halt, conn} ->
          conn

        :ok ->
          do_handle_pack_import(conn, pack_dir)
      end

    err = is_struct(result, Plug.Conn) and result.status >= 400
    Keyverse.Metrics.record(:http_import, (System.monotonic_time(:microsecond) - t0) / 1000, %{error: err})
    result
  end

  defp do_handle_pack_import(conn, pack_dir) do
    conn = Plug.Conn.fetch_query_params(conn)
    mode = if conn.query_params["mode"] == "replace", do: :replace, else: :merge

    zip_bin =
      cond do
        is_map(conn.body_params) and is_map(conn.body_params["pack"]) ->
          upload = conn.body_params["pack"]

          cond do
            is_struct(upload, Plug.Upload) ->
              case File.stat(upload.path) do
                {:ok, %{size: size}} ->
                  if size > Config.max_import_bytes() do
                    {:too_large, size}
                  else
                    File.read!(upload.path)
                  end

                _ ->
                  nil
              end

            is_map(upload) and is_binary(upload["path"]) ->
              case File.stat(upload["path"]) do
                {:ok, %{size: size}} ->
                  if size > Config.max_import_bytes() do
                    {:too_large, size}
                  else
                    File.read!(upload["path"])
                  end

                _ ->
                  nil
              end

            true ->
              nil
          end

        true ->
          case Attach.read_body_capped(conn, Config.max_import_bytes()) do
            {:ok, body, _} -> body
            {:error, :too_large} -> {:too_large, nil}
            _ -> nil
          end
      end

    cond do
      match?({:too_large, _}, zip_bin) ->
        send_json(conn, 413, %{
          error: "import too large (max #{Config.max_import_bytes()} bytes)",
          max_bytes: Config.max_import_bytes()
        })

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
  end

  defp handle_api_attach(conn, pack_dir, "POST", slug) do
    t0 = System.monotonic_time(:microsecond)
    door = pack_door(pack_dir)

    result =
      case enforce_rates(conn, [
             {:global_write, Config.rate_global_write()},
             {{:attach, door}, Config.rate_attach()}
           ]) do
        {:halt, conn} ->
          conn

        :ok ->
          case Scope.parse(slug) do
            nil ->
              send_json(conn, 400, %{error: "invalid passage address"})

            scope ->
              ct =
                conn
                |> get_req_header("content-type")
                |> List.first()
                |> to_string()
                |> String.downcase()

              existing = Note.read(pack_dir, scope.slug)
              existing_atts = (existing && existing["attachments"]) || []

              case Attach.check_count(existing_atts) do
                {:error, msg} ->
                  send_json(conn, 400, %{error: msg, max: Attach.max_per_note()})

                :ok ->
                  do_attach_post(conn, pack_dir, scope, existing, ct)
              end
          end
      end

    err = is_struct(result, Plug.Conn) and result.status >= 400
    Keyverse.Metrics.record(:http_attach, (System.monotonic_time(:microsecond) - t0) / 1000, %{error: err})
    result
  end

  defp handle_api_attach(conn, _, _, _) do
    send_json(conn, 405, %{error: "method not allowed"})
  end

  defp do_attach_post(conn, pack_dir, scope, existing, ct) do
    cond do
      String.contains?(ct, "application/json") or
          (is_map(conn.body_params) and Map.has_key?(conn.body_params, "kind")) ->
        parsed =
          if is_map(conn.body_params) and map_size(conn.body_params) > 0 do
            conn.body_params
          else
            case Attach.read_body_capped(conn, 64_000) do
              {:ok, body, _} ->
                case Jason.decode(body) do
                  {:ok, p} when is_map(p) -> p
                  _ -> %{}
                end

              {:error, reason} ->
                {:body_error, reason}
            end
          end

        case parsed do
          {:body_error, reason} ->
            send_json(conn, Attach.error_status(reason), %{error: Attach.error_message(reason)})

          %{"kind" => "url", "url" => url} = p ->
            case Attach.validate_url(url) do
              {:ok, safe_url} ->
                att = %{
                  "id" => Note.new_att_id(),
                  "kind" => "url",
                  "url" => safe_url,
                  "title" => Attach.sanitize_title(p["title"]),
                  "created_at" => Note.iso_now()
                }

                attach_to_note(conn, pack_dir, scope, existing, att)

              {:error, msg} ->
                send_json(conn, 400, %{error: msg})
            end

          _ ->
            send_json(conn, 400, %{error: "invalid attachment json"})
        end

      true ->
        case Attach.read_body_capped(conn) do
          {:ok, body, conn} ->
            filename =
              conn
              |> get_req_header("x-filename")
              |> List.first()
              |> decode_filename_header()
              |> Attach.sanitize_filename()

            mime = Attach.sanitize_mime(ct)

            case Note.write_attachment_blob!(pack_dir, body) do
              {:ok, sha} ->
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

              {:error, reason, usage} ->
                send_json(conn, Keyverse.PackQuota.http_status(reason), %{
                  error: Keyverse.PackQuota.error_message(reason, usage),
                  quota: usage
                })
            end

          {:error, reason} ->
            send_json(conn, Attach.error_status(reason), %{
              error: Attach.error_message(reason),
              max_bytes: Attach.max_bytes()
            })
        end
    end
  end

  defp attach_to_note(conn, pack_dir, scope, existing, att) do
    if existing && Note.encrypted?(existing) do
      send_json(conn, 200, %{encrypted: true, attachment: att})
    else
      case Note.attach_meta!(pack_dir, scope, existing, att) do
        {:ok, note} ->
          send_json(conn, 200, note)

        {:error, msg} ->
          send_json(conn, 400, %{error: to_string(msg)})
      end
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
            case Note.detach_meta!(pack_dir, scope, note, att_id) do
              {:ok, note} -> send_json(conn, 200, note)
              {:error, :not_found} -> send_json(conn, 404, %{error: "attachment not found"})
              {:error, msg} -> send_json(conn, 400, %{error: to_string(msg)})
            end
        end
    end
  end

  defp handle_api_detach(conn, _, _, _, _) do
    send_json(conn, 405, %{error: "method not allowed"})
  end

  defp handle_api_blob(conn, pack_dir, sha) do
    sha = String.downcase(sha)
    path = Note.attach_blob_path(pack_dir, sha)

    case path && File.stat(path) do
      {:ok, %File.Stat{type: :regular, size: size}} ->
        {mime, name} = Note.attachment_meta_for_sha(pack_dir, sha)
        name = Attach.sanitize_filename(conn.query_params["name"] || name)
        mime = Attach.sanitize_mime(mime)

        # Stream file; avoid loading multi-MB into BEAM heap twice.
        conn =
          conn
          |> put_resp_content_type(mime)
          |> put_resp_header("content-disposition", Attach.content_disposition(name, mime))
          |> put_resp_header("x-content-type-options", "nosniff")
          |> put_resp_header("cache-control", "private, max-age=31536000, immutable")
          |> put_resp_header("content-length", Integer.to_string(size))
          |> send_file(200, path)

        conn

      _ ->
        send_json(conn, 404, %{error: "attachment not found"})
    end
  end

  defp decode_filename_header(nil), do: nil

  defp decode_filename_header(name) when is_binary(name) do
    # Client may send encodeURIComponent; tolerate plain names too.
    case URI.decode(name) do
      decoded when is_binary(decoded) -> decoded
      _ -> name
    end
  rescue
    _ -> name
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

  defp protocol_info(door, access) do
    pack_id = access[:pack_id] || access["pack_id"]
    role = access[:role] || access["role"] || "write"

    %{
      protocol: Config.protocol_name(),
      version: Config.protocol_version(),
      app_version: Config.app_version(),
      multipack: not Config.door_open?(),
      door: not Config.door_open?() and door != "",
      door_phrase: if(door == "", do: nil, else: door),
      pack_id: pack_id,
      role: role,
      door_open: Config.door_open?(),
      cors: not cors_disabled?(),
      max_attach_bytes: Config.max_attach_bytes(),
      max_attach_per_note: Config.max_attach_per_note(),
      max_import_bytes: Config.max_import_bytes(),
      max_pack_attach_bytes: Config.max_pack_attach_bytes(),
      max_pack_attach_count: Config.max_pack_attach_count(),
      rate_limits: %{
        attach_per_min: elem(Config.rate_attach(), 0),
        put_per_min: elem(Config.rate_put_note(), 0),
        import_per_hour: elem(Config.rate_import(), 0),
        setup_per_hour: elem(Config.rate_setup(), 0),
        global_write_per_min: elem(Config.rate_global_write(), 0)
      },
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
        pack_quota: true,
        rate_limit: true,
        door_rotate: true,
        opaque_pack_id: true,
        metrics: true,
        pwa: true,
        local_fs_mount_ro: true,
        activity: true,
        host: "elixir"
      },
      endpoints: [
        "GET /api/protocol",
        "GET /api/door",
        "POST /api/door/rotate",
        "GET /api/notes",
        "GET /api/activity",
        "GET /api/activity?date=YYYY-MM-DD",
        "GET /api/resolve?q=",
        "GET /api/suggest?q=&limit=",
        "GET /api/text/bsb/<book>/<chapter>",
        "GET /api/read/<slug>",
        "GET /api/md/<slug>",
        "GET /api/note/<slug>",
        "GET /api/note/<slug>?raw",
        "PUT /api/note/<slug>",
        "POST /api/note/<slug>/attachments",
        "DELETE /api/note/<slug>/attachments/<att_id>",
        "GET /api/attachments/<sha256>",
        "GET /api/pack",
        "GET /api/pack/export",
        "POST /api/pack/import",
        "GET /api/share-qr?origin=&path=",
        "GET /activity",
        "GET /local",
        "GET /metrics",
        "GET /manifest.webmanifest",
        "GET /sw.js",
        "GET /offline",
        "GET /health"
      ],
      ownership: %{
        user_owned_pack: true,
        source_of_truth: "filesystem pack directory (opaque pack_id)",
        access: "multiword door binding (rotatable)",
        export: "GET /api/pack/export",
        import: "POST /api/pack/import?mode=merge|replace",
        local_mount: "GET /local (browser directory / OPFS, read-only)"
      },
      scaling: %{
        pack_write_queue: "per-pack GenServer",
        pack_attach_quota: "MAX_PACK_ATTACH_BYTES / MAX_PACK_ATTACH_COUNT",
        rate_limits: "door + global write budgets (ETS)",
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

  defp pack_door(pack_dir), do: Pack.read_pack_id(pack_dir)

  defp write_role?(access) when is_map(access) do
    role = access[:role] || access["role"] || "write"
    to_string(role) == "write"
  end

  defp write_role?(_), do: true

  defp require_write(conn, access, fun) when is_function(fun, 0) do
    if write_role?(access), do: fun.(), else: forbid_write(conn)
  end

  defp forbid_write(conn) do
    send_json(conn, 403, %{error: "read-only key", message: "this key cannot change the pack"})
  end

  defp client_ip_key(conn) do
    # Prefer edge-provided client IP when present (Railway/proxy).
    xf =
      conn
      |> get_req_header("x-forwarded-for")
      |> List.first()
      |> case do
        nil -> nil
        s -> s |> String.split(",") |> List.first() |> to_string() |> String.trim()
      end

    cond do
      is_binary(xf) and xf != "" -> xf
      true ->
        case conn.remote_ip do
          tup when is_tuple(tup) -> tup |> :inet.ntoa() |> to_string()
          _ -> "unknown"
        end
    end
  end

  # checks is a list of {bucket_key | {:setup_ip, ...} special, {limit, window_ms}}
  defp enforce_rates(conn, checks) when is_list(checks) do
    Enum.reduce_while(checks, :ok, fn {bucket, {limit, window}}, :ok ->
      key =
        case bucket do
          :setup_ip -> "setup:" <> client_ip_key(conn)
          :global_write -> "global:write"
          other -> "k:" <> inspect(other)
        end

      case RateLimit.check(key, limit, window) do
        :ok ->
          {:cont, :ok}

        {:error, :rate_limited, ms} ->
          retry_s = max(1, div(ms + 999, 1000))

          conn =
            conn
            |> put_resp_header("retry-after", Integer.to_string(retry_s))
            |> put_resp_header("cache-control", "no-store")
            |> send_json(429, %{
              error: "rate limited",
              retry_after_ms: ms,
              retry_after_s: retry_s
            })

          {:halt, {:halt, conn}}
      end
    end)
    |> case do
      :ok -> :ok
      {:halt, conn} -> {:halt, conn}
    end
  end

  defp parse_activity_days(s) when is_binary(s) do
    case Integer.parse(s) do
      {n, _} when n >= 7 and n <= 400 -> n
      _ -> 365
    end
  end

  defp parse_activity_days(n) when is_integer(n) and n >= 7 and n <= 400, do: n
  defp parse_activity_days(_), do: 365

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
      |> put_resp_header(
        "access-control-allow-headers",
        "content-type, x-filename, accept, x-kv-base-updated-at, x-kv-allow-shrink"
      )
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

  @doc false
  # Safe deep-link path under this door: / or /note|read/<slug>
  def normalize_share_path(nil), do: "/"
  def normalize_share_path(""), do: "/"

  def normalize_share_path(path) when is_binary(path) do
    p = String.trim(path)

    cond do
      p in ["", "/"] ->
        "/"

      String.contains?(p, "..") or String.contains?(p, "://") or String.starts_with?(p, "//") ->
        nil

      not String.starts_with?(p, "/") ->
        nil

      Regex.match?(~r{\A/(note|read)/[a-z0-9][a-z0-9.\-]*\z}i, p) ->
        # Canonicalize: lowercase slug segment
        [_, kind, slug] = Regex.run(~r{\A/(note|read)/(.+)\z}i, p)
        "/#{String.downcase(kind)}/#{String.downcase(slug)}"

      true ->
        nil
    end
  end

  def normalize_share_path(_), do: nil
end
