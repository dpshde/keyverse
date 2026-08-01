defmodule Keyverse.Html do
  @moduledoc "Server-rendered HTML shells; client JS/CSS from priv/static."

  alias Keyverse.{Config, Note, Scope}

  def esc(nil), do: ""
  def esc(s), do: Plug.HTML.html_escape(to_string(s))

  def page(title, body, opts \\ []) do
    base = Keyword.get(opts, :base, "")
    man_scope = Keyword.get(opts, :manifest_scope, base)
    man_path = if man_scope == "", do: "/manifest.webmanifest", else: "#{man_scope}/manifest.webmanifest"
    pwa_head = static_text("pwa-head.html")
    fathom = fathom_tag()

    """
    <!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>#{esc(title)}</title>
    #{pwa_head}
    <link rel="manifest" href="#{esc(man_path)}">
    <link rel="stylesheet" href="/app.css">
    <script>window.BASE=#{Jason.encode!(base)};var BASE=window.BASE;</script>
    <script src="/crypto.js"></script>
    <script>if(window.VP_CRYPTO)VP_CRYPTO.ingestHash();</script>
    #{fathom}
    </head><body>#{body}
    <script src="/pwa-boot.js"></script>
    </body></html>
    """
  end

  defp static_text(name) do
    path = Path.join(Config.static_dir(), name)

    case File.read(path) do
      {:ok, body} -> body
      _ -> ""
    end
  end

  defp fathom_tag do
    site = Config.fathom_site()

    if site == "" do
      ""
    else
      ~s(<script src="https://cdn.usefathom.com/script.js" data-site="#{esc(site)}" defer></script>)
    end
  end

  def site_footer(install? \\ false) do
    install =
      if install? do
        ~s(<button type="button" class="pwa-install" id="pwa-install">Install app</button>)
      else
        ""
      end

    """
    <footer class="site-foot ui">#{install}<span class="muted">no account · just your key</span></footer>
    """
  end

  def render_setup(opts \\ []) do
    error = Keyword.get(opts, :error, "")
    suggested = Keyword.get(opts, :suggested) || "quiet-river-lantern-notes"

    err =
      if error != "",
        do: ~s(<p class="login-error" role="alert">#{esc(error)}</p>),
        else: ""

    body = """
    <div class="login">
      <h1>keyverse</h1>
      <p class="lead">Create your notes. Your key is four words — no account.</p>
      #{err}
      <form class="login-form" method="post" action="/setup" id="setup-form">
        <label for="door">Your key</label>
        <input type="text" id="door" name="door"
          value="#{esc(suggested)}"
          placeholder="four-words-like-this"
          autocomplete="off" autocapitalize="off" spellcheck="false"
          required autofocus>
        <button type="submit" class="login-btn" name="intent" value="claim">Create and open notes</button>
        <button type="submit" class="login-btn login-btn-secondary" name="intent" value="generate"
          formnovalidate>Suggest another key</button>
      </form>
      <p class="muted" style="margin-top:1rem"><a href="/">← Already have a key?</a></p>
      <details class="login-more">
        <summary>How keys work</summary>
        <p>Your key is four words that open <strong>your</strong> pack of notes — also the link
          (e.g. <code>…/quiet-river-lantern-notes/</code>). Bookmark it. Anyone with the link can open the same notes.
          A different key is a different pack.</p>
      </details>
      #{site_footer(false)}
    </div>
    <script>
    (function () {
      var KEY = "vp_door_key";
      var form = document.getElementById("setup-form");
      var input = document.getElementById("door");
      if (!form || !input) return;
      form.addEventListener("submit", function (e) {
        var intent = (e.submitter && e.submitter.value) || "claim";
        if (intent === "generate") return;
        var v = (input.value || "").trim().toLowerCase().replace(/\\s+/g, "-");
        if (v) try { localStorage.setItem(KEY, v); } catch (err) {}
      });
    })();
    </script>
    """

    page("keyverse · setup", body, base: "", manifest_scope: "")
  end

  def render_enter(opts \\ []) do
    error = Keyword.get(opts, :error, "")
    local? = Keyword.get(opts, :local, false)

    err =
      if error != "",
        do: ~s(<p class="login-error" role="alert">#{esc(error)}</p>),
        else: ""

    create_link = """
    <p class="muted" style="margin-top:1.1rem">
      <a href="/setup">Create a new key</a>
      <span style="opacity:.55"> — starts a new empty pack of notes</span>
    </p>
    """

    key_form = fn required, autofocus, btn ->
      """
      <form class="login-form" method="get" action="/enter" id="login-form">
        <label for="door">Your key</label>
        <input type="text" id="door" name="door"
          placeholder="four-words-like-this"
          autocomplete="username" autocapitalize="off" spellcheck="false"
          #{if required, do: "required", else: ""} #{if autofocus, do: "autofocus", else: ""}>
        <button type="submit" class="login-btn">#{esc(btn)}</button>
      </form>
      """
    end

    body_inner =
      if local? do
        """
        <h1>keyverse</h1>
        <p class="lead">Your scripture notes.</p>
        #{err}
        <a class="login-btn" href="#" id="open-my-notes">Open my notes</a>
        <details class="login-more"#{if error != "", do: " open", else: ""}>
          <summary>Use a different key</summary>
          #{key_form.(true, error != "", "Continue")}
        </details>
        #{create_link}
        """
      else
        """
        <h1>keyverse</h1>
        <p class="lead">Open your notes with your key.</p>
        #{err}
        #{key_form.(true, true, "Open notes")}
        #{create_link}
        <div class="ios-install-hint" id="ios-install-hint">
          <strong>Install on this device:</strong> Share → <strong>Add to Home Screen</strong>.
        </div>
        <details class="login-more">
          <summary>Don’t have a key?</summary>
          <p><a href="/setup">Create a new key</a> — four words, no account. Bookmark the page after you open.</p>
          <p>Opening someone else’s notes? Ask them for their link.</p>
        </details>
        #{site_footer(true)}
        """
      end

    body = """
    <div class="login">#{body_inner}</div>
    <script>
    (function () {
      var KEY = "vp_door_key";
      var input = document.getElementById("door");
      var form = document.getElementById("login-form");
      var openMine = document.getElementById("open-my-notes");
      try {
        var saved = localStorage.getItem(KEY);
        if (saved) {
          if (input && !input.value) input.value = saved;
          if (openMine) openMine.href = "/" + saved.replace(/\\s+/g, "-").toLowerCase() + "/";
        } else if (openMine) {
          openMine.href = "/setup";
          openMine.textContent = "Create my notes";
        }
      } catch (e) {}
      if (input && form) {
        form.addEventListener("submit", function () {
          var v = (input.value || "").trim().toLowerCase().replace(/\\s+/g, "-");
          if (v) try { localStorage.setItem(KEY, v); } catch (e) {}
        });
      }
      var ua = navigator.userAgent || "";
      var isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      var isStandalone = window.matchMedia("(display-mode: standalone)").matches
        || window.navigator.standalone === true;
      var hint = document.getElementById("ios-install-hint");
      if (hint && isIOS && !isStandalone) hint.classList.add("show");
    })();
    </script>
    """

    page("keyverse", body, base: "", manifest_scope: "")
  end

  def render_offline do
    body = """
    <div class="login offline-page">
      <h1>You’re offline</h1>
      <p>keyverse can’t reach the network. Cached pages may still open.</p>
      <p><a href="/">Try again</a></p>
    </div>
    """

    page("Offline · keyverse", body, base: "", manifest_scope: "")
  end

  def render_dead_link do
    body = """
    <div class="login">
      <h1>keyverse</h1>
      <p class="lead">That link didn’t open anything.</p>
      <p class="muted"><a href="/">Try your key again</a>
        · <a href="/setup">Create a new key</a></p>
    </div>
    """

    page("keyverse", body, base: "", manifest_scope: "")
  end

  def door_share_chip(door) when is_binary(door) and door != "" do
    """
    <div class="door-share-wrap" id="door-share-wrap" data-open="0">
      <button type="button" class="door-share" id="door-share" data-key="#{esc(door)}"
        title="Share your notes link" aria-label="Share notes link: #{esc(door)}"
        aria-expanded="false" aria-controls="door-share-panel">
        <span class="door-share-key">#{esc(door)}</span>
        <span class="door-share-hint" aria-hidden="true">↗</span>
      </button>
      <div class="door-share-panel" id="door-share-panel" role="dialog"
        aria-label="Share your notes" hidden>
        <div class="door-share-head">
          <div class="door-share-title" id="door-share-title">#{esc(door)}</div>
          <button type="button" class="door-share-x" id="door-share-close"
            title="Close" aria-label="Close share">×</button>
        </div>
        <div class="door-share-qr" id="door-share-qr" aria-busy="true"></div>
        <div class="door-share-actions">
          <button type="button" class="door-share-action" id="door-share-action">Share</button>
          <button type="button" class="door-share-copy" id="door-share-copy">Copy link</button>
        </div>
      </div>
    </div>
    <script src="/door-share.js"></script>
    """
  end

  def door_share_chip(_), do: ""

  def ref_search_html(base) do
    """
    <form class="ref-search" id="ref-form" action="#{esc(base)}/go" method="get" role="search">
      <label class="sr-only" for="ref-input">Passage</label>
      <input type="text" id="ref-input" name="q" placeholder="John 3:16" autocomplete="off"
        autocapitalize="off" spellcheck="false" enterkeyhint="go">
      <ul class="ref-suggest" id="ref-suggest" hidden role="listbox"></ul>
      <button type="submit" class="ref-go">Go</button>
    </form>
    <script src="/ref-search.js"></script>
    """
  end

  def crypto_bar(locked?) do
    """
    <div class="crypto-bar ui" id="crypto-bar" data-locked="#{if locked?, do: "1", else: "0"}">
      <span class="crypto-status" id="crypto-status"></span>
      <button type="button" class="crypto-btn" id="crypto-unlock" hidden>Unlock</button>
      <button type="button" class="crypto-btn" id="crypto-set" hidden>Set passphrase</button>
      <button type="button" class="crypto-btn" id="crypto-clear" hidden>Lock</button>
    </div>
    <script src="/crypto-bar.js"></script>
    """
  end

  def render_index(pack_dir, door, base) do
    notes = Note.list(pack_dir)
    tree = home_tree_html(notes, base)

    body = """
    <header class="ui home-head">
      #{door_share_chip(door)}
      <h1>keyverse</h1>
    </header>
    #{crypto_bar(false)}
    #{ref_search_html(base)}
    <section class="home-notes">
      <h2 class="ui muted">Notes</h2>
      #{tree}
    </section>
    #{site_footer(true)}
    <script src="/home-tree.js"></script>
    """

    page("keyverse", body, base: base)
  end

  defp home_tree_html([], _base) do
    ~s(<p class="muted">No notes yet. Search a passage above to start.</p>)
  end

  defp home_tree_html(notes, base) do
    items =
      Enum.map(notes, fn n ->
        scope = n["scope"] || %{}
        slug = scope["slug"] || ""
        osis = scope["osis"] || slug
        kind = scope["kind"] || "verse"

        label =
          case Scope.parse(slug) do
            nil -> osis
            s -> Scope.display(s)
          end

        href =
          if kind == "chapter",
            do: "#{base}/read/#{slug}",
            else: "#{base}/note/#{slug}"

        excerpt = excerpt_note(n)

        """
        <li class="note-row">
          <a href="#{esc(href)}">
            <span class="note-ref">#{esc(label)}</span>
            <span class="note-ex">#{esc(excerpt)}</span>
          </a>
        </li>
        """
      end)

    ~s(<ul class="note-list">#{Enum.join(items, "\n")}</ul>)
  end

  defp excerpt_note(note) do
    cond do
      Note.encrypted?(note) ->
        "Encrypted"

      true ->
        (note["blocks"] || [])
        |> Enum.map(& &1["text"])
        |> Enum.join(" ")
        |> String.trim()
        |> String.slice(0, 120)
    end
  end

  def render_editor(pack_dir, scope, base) do
    note = Note.read(pack_dir, scope.slug)
    locked? = note != nil and Note.encrypted?(note)
    display = Scope.display(scope)

    initial =
      cond do
        locked? -> [%{"id" => "b_new", "indent" => 0, "text" => ""}]
        note && note["blocks"] != [] -> note["blocks"]
        true -> [%{"id" => "b_new", "indent" => 0, "text" => ""}]
      end

    atts = if locked?, do: [], else: (note && note["attachments"]) || []
    cipher_json = if locked?, do: Jason.encode!(note["cipher"]), else: "null"
    rel = related_html(pack_dir, scope, base)

    body = """
    <header class="ui">
      <a href="#{esc(base)}/" class="muted">&larr;</a>
      <h1>#{esc(display)}</h1>
      <a class="muted" href="#{esc(base)}/read/#{esc(scope.slug)}">read</a>
      <span id="status"></span>
    </header>
    #{crypto_bar(locked?)}
    <div id="note-main" #{if locked?, do: "hidden", else: ""}>
    <div id="editor"></div>
    <div id="att-root"></div>
    </div>
    <div id="crypto-gate" class="crypto-lock" #{if locked?, do: "", else: "hidden"}>
      <h2>Encrypted note</h2>
      <p>This note is sealed with a client-side passphrase (cowyo-style). The server only stores ciphertext. Enter the passphrase or open with <code>#pw=…</code> in the URL.</p>
      <form id="crypto-unlock-form">
        <input type="password" id="crypto-pw" placeholder="Passphrase" autocomplete="current-password" required>
        <button type="submit">Unlock</button>
      </form>
      <p class="muted" id="crypto-err" hidden>Could not decrypt — wrong passphrase?</p>
    </div>
    #{rel}
    <script type="application/json" id="page-meta">#{Jason.encode!(%{slug: scope.slug, display: display})}</script>
    <script type="application/json" id="initial-blocks">#{Jason.encode!(initial)}</script>
    <script type="application/json" id="initial-atts">#{Jason.encode!(atts)}</script>
    <script type="application/json" id="initial-cipher">#{cipher_json}</script>
    <script src="/outliner.js"></script>
    <script src="/editor-page.js"></script>
    """

    page(display, body, base: base)
  end

  defp related_html(pack_dir, scope, base) do
    notes = Note.list(pack_dir)

    buckets =
      Enum.reduce(notes, %{contains: [], within: [], overlaps: []}, fn n, acc ->
        slug = get_in(n, ["scope", "slug"])
        if slug == scope.slug do
          acc
        else
          case Scope.parse(slug) do
            nil ->
              acc

            other ->
              case Scope.relate(scope, other) do
                :contains -> update_in(acc.contains, &[{other, n} | &1])
                :within -> update_in(acc.within, &[{other, n} | &1])
                :overlaps -> update_in(acc.overlaps, &[{other, n} | &1])
                _ -> acc
              end
          end
        end
      end)

    [
      related_section("contains", "Within", "Notes on passages inside #{Scope.display(scope)}", buckets.contains, base),
      related_section("within", "Part of", "Broader passages this note sits in", buckets.within, base),
      related_section("overlaps", "Overlaps", "Ranges that partially overlap this note", buckets.overlaps, base)
    ]
    |> Enum.reject(&(&1 == ""))
    |> Enum.join("\n")
  end

  defp related_section(_kind, _label, _sub, [], _base), do: ""

  defp related_section(_kind, label, sub, entries, base) do
    items =
      Enum.map(entries, fn {sc, n} ->
        href = "#{base}/note/#{sc.slug}"
        ex = excerpt_note(n)

        """
        <li class="note-row"><a href="#{esc(href)}">
          <span class="note-ref">#{esc(Scope.display(sc))}</span>
          <span class="note-ex">#{esc(ex)}</span>
        </a></li>
        """
      end)

    """
    <section class="related ui">
      <h2>#{esc(label)}</h2>
      <p class="muted">#{esc(sub)}</p>
      <ul class="note-list">#{Enum.join(items, "")}</ul>
    </section>
    """
  end

  def render_read(pack_dir, scope, base) do
    display = Scope.display(scope)
    book = scope.parsed.book
    chapter = scope.parsed.chapter

    {text_block, err} =
      case Keyverse.TextCache.get_chapter(book, chapter) do
        {:ok, doc} ->
          verses =
            Enum.map(doc["verses"] || [], fn v ->
              vn = v["v"]
              vt = v["text"] || ""
              ~s(<p class="verse" data-v="#{esc(to_string(vn))}"><sup>#{esc(to_string(vn))}</sup> #{esc(vt)}</p>)
            end)

          {Enum.join(verses, "\n"), nil}

        {:error, reason} ->
          {nil, to_string(reason)}
      end

    if err do
      body = """
      <p>Could not fetch text (#{esc(err)}). <a href="#{esc(base)}/">Back</a></p>
      """

      page("keyverse", body, base: base)
    else
      # notes for this chapter
      notes = Note.list(pack_dir)

      note_map =
        notes
        |> Enum.filter(fn n ->
          slug = get_in(n, ["scope", "slug"]) || ""
          String.starts_with?(slug, String.downcase("#{book}."))
        end)
        |> Enum.map(fn n -> {get_in(n, ["scope", "slug"]), n} end)
        |> Map.new()

      meta = %{
        slug: scope.slug,
        display: display,
        book: book,
        chapter: chapter,
        kind: scope.kind
      }

      body = """
      <header class="ui">
        <a href="#{esc(base)}/" class="muted">&larr;</a>
        <h1>#{esc(display)}</h1>
        <a class="muted" href="#{esc(base)}/note/#{esc(scope.slug)}">note</a>
      </header>
      #{crypto_bar(false)}
      <article class="reader" id="reader">
        #{text_block}
      </article>
      <script type="application/json" id="page-meta">#{Jason.encode!(meta)}</script>
      <script type="application/json" id="chapter-notes">#{Jason.encode!(note_map)}</script>
      <script src="/outliner.js"></script>
      <script src="/reader-page.js"></script>
      """

      page(display, body, base: base)
    end
  end

  def web_manifest(start_url) do
    %{
      name: "keyverse",
      short_name: "keyverse",
      description: "Scripture notes — multiword key, no account",
      start_url: start_url,
      scope: "/",
      display: "standalone",
      background_color: "#f7f4ef",
      theme_color: "#1c1915",
      icons: [
        %{src: "/icons/icon-192.png", sizes: "192x192", type: "image/png"},
        %{src: "/icons/icon-512.png", sizes: "512x512", type: "image/png"},
        %{
          src: "/icons/icon-maskable-192.png",
          sizes: "192x192",
          type: "image/png",
          purpose: "maskable"
        },
        %{
          src: "/icons/icon-maskable-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable"
        }
      ]
    }
  end
end
