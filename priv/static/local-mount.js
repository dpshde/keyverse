/**
 * Read-only local pack mount UI (ADR 0017 Phase 1).
 * Requires pack-store.js. Mounts via directory picker or test OPFS seed API.
 */
(function () {
  "use strict";

  var store = null;
  var view = "landing"; // landing | home | note
  var currentSlug = null;
  var blobUrls = [];

  var el = {
    app: document.getElementById("local-app"),
    status: document.getElementById("local-status"),
    badge: document.getElementById("local-badge"),
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fmtSize(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    return (n / 1048576).toFixed(1) + " MB";
  }

  function setStatus(msg, isError) {
    if (!el.status) return;
    el.status.hidden = !msg;
    el.status.textContent = msg || "";
    el.status.classList.toggle("is-error", !!isError);
  }

  function setBadge(text) {
    if (!el.badge) return;
    if (!text) {
      el.badge.hidden = true;
      el.badge.textContent = "";
      return;
    }
    el.badge.textContent = text;
    el.badge.hidden = false;
  }

  function revokeBlobs() {
    for (var i = 0; i < blobUrls.length; i++) {
      try {
        URL.revokeObjectURL(blobUrls[i]);
      } catch (e) {}
    }
    blobUrls = [];
  }

  /** Match reader outline grid: chevron | bullet | text (3 columns). */
  function outlineHtml(blocks) {
    var items = blocks || [];
    if (!items.length) return '<p class="muted">Empty note.</p>';
    var hidden = new Set();
    for (var i = 0; i < items.length; i++) {
      if (!items[i].collapsed) continue;
      var base = Math.max(0, items[i].indent | 0);
      for (var j = i + 1; j < items.length; j++) {
        var d = Math.max(0, items[j].indent | 0);
        if (d <= base) break;
        hidden.add(j);
      }
    }
    return (
      '<div class="outline local-ro-outline" data-testid="note-outline">' +
      items
        .map(function (b, idx) {
          if (hidden.has(idx)) return "";
          var depth = Math.max(0, b.indent | 0);
          var empty = !(b.text && String(b.text).trim());
          var hasKids =
            idx + 1 < items.length && Math.max(0, items[idx + 1].indent | 0) > depth;
          var collapsed = !!(b.collapsed && hasKids);
          var cls = "oline";
          if (empty) cls += " blank";
          if (hasKids) cls += " has-kids";
          if (collapsed) cls += " collapsed";
          return (
            '<div class="' +
            cls +
            '" style="--depth:' +
            depth +
            '">' +
            '<span class="ochev" aria-hidden="true"></span>' +
            '<span class="odot" aria-hidden="true"></span>' +
            '<span class="otxt">' +
            (empty ? "" : esc(b.text)) +
            "</span></div>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function formatLabel(meta) {
    if (!meta) return "";
    return meta.label || meta.slug || "";
  }

  async function renderLanding() {
    view = "landing";
    currentSlug = null;
    revokeBlobs();
    var canPick = window.KeyversePackStore && KeyversePackStore.canUseDirectoryPicker();
    var canOpfs = window.KeyversePackStore && KeyversePackStore.canUseOpfs();
    setBadge(null);

    el.app.innerHTML =
      '<div class="login local-landing" data-testid="local-landing">' +
      "<h1>keyverse</h1>" +
      '<p class="lead">Open notes from a folder on this device.</p>' +
      (canPick
        ? '<button type="button" class="login-btn" id="local-open-btn" data-testid="local-open-btn">Open folder…</button>'
        : '<p class="login-error" role="status" data-testid="local-unsupported">Opening a folder needs Chrome or Edge on this device.</p>') +
      '<p class="muted local-secondary-links">' +
      '<a href="/">Open with a key</a>' +
      "</p>" +
      (canOpfs
        ? '<span class="sr-only" data-testid="local-opfs-ready">OPFS available</span>'
        : "") +
      "</div>";

    var btn = document.getElementById("local-open-btn");
    if (btn) {
      btn.addEventListener("click", function () {
        openPicker();
      });
    }
  }

  async function openPicker() {
    setStatus("Opening folder…");
    try {
      store = await KeyversePackStore.pickAndOpenLocalPack();
      setStatus("");
      await renderHome();
    } catch (e) {
      if (e && e.name === "AbortError") {
        setStatus("");
        return;
      }
      setStatus((e && e.message) || "Couldn’t open that folder", true);
    }
  }

  async function mountStore(next) {
    store = next;
    setStatus("");
    await renderHome();
    return store;
  }

  async function renderHome() {
    if (!store) return renderLanding();
    view = "home";
    currentSlug = null;
    revokeBlobs();
    setStatus("Loading…");
    var man;
    var notes;
    try {
      man = await store.manifest();
      notes = await store.listNotes();
    } catch (e) {
      setStatus((e && e.message) || "Couldn’t read notes", true);
      return;
    }
    setStatus("");
    setBadge(null);

    var list;
    if (!notes.length) {
      list = '<p class="muted" data-testid="local-empty">No notes yet.</p>';
    } else {
      list =
        '<ul class="local-note-list" id="local-note-list" data-testid="local-note-list">' +
        notes
          .map(function (n) {
            var sub = [];
            if (n.encrypted) sub.push("locked");
            if (n.attachment_count) {
              sub.push(n.attachment_count + " file" + (n.attachment_count === 1 ? "" : "s"));
            }
            return (
              '<li class="local-note-row">' +
              '<button type="button" class="local-note-open" data-slug="' +
              esc(n.slug) +
              '" data-testid="note-link-' +
              esc(n.slug) +
              '">' +
              '<span class="local-note-label">' +
              esc(formatLabel(n)) +
              "</span>" +
              (sub.length
                ? '<span class="muted local-note-meta">' + esc(sub.join(" · ")) + "</span>"
                : "") +
              "</button></li>"
            );
          })
          .join("") +
        "</ul>";
    }

    var label = store.label || "This folder";
    var countBits = [];
    countBits.push((man.notes | 0) + " note" + ((man.notes | 0) === 1 ? "" : "s"));
    if (man.attachments) {
      countBits.push((man.attachments | 0) + " file" + ((man.attachments | 0) === 1 ? "" : "s"));
    }
    el.app.innerHTML =
      '<div class="local-page" data-testid="local-home">' +
      '<header class="local-page-head">' +
      "<h1>keyverse</h1>" +
      '<p class="muted local-pack-sub" data-testid="local-pack-label">' +
      esc(label) +
      " · " +
      esc(countBits.join(" · ")) +
      " · view only</p>" +
      "</header>" +
      '<section class="local-notes-section">' +
      '<h2 class="local-section-label">Notes</h2>' +
      list +
      "</section>" +
      '<footer class="local-page-foot muted" data-testid="local-manifest">' +
      '<a href="#" id="local-change-pack" data-testid="local-change-pack">Open another folder</a>' +
      '<span class="local-dot" aria-hidden="true">·</span>' +
      '<a href="#" id="local-unmount" data-testid="local-unmount">Close</a>' +
      '<span class="local-dot" aria-hidden="true">·</span>' +
      '<a href="/">Open with a key</a>' +
      "</footer>" +
      "</div>";

    el.app.querySelectorAll(".local-note-open").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openNote(btn.getAttribute("data-slug"));
      });
    });
    var change = document.getElementById("local-change-pack");
    if (change) {
      change.addEventListener("click", function (e) {
        e.preventDefault();
        openPicker();
      });
    }
    var un = document.getElementById("local-unmount");
    if (un) {
      un.addEventListener("click", function (e) {
        e.preventDefault();
        store = null;
        renderLanding();
      });
    }
  }

  async function openNote(slug) {
    if (!store || !slug) return;
    view = "note";
    currentSlug = slug;
    revokeBlobs();
    setStatus("Loading note…");
    var note;
    try {
      note = await store.getNote(slug);
    } catch (e) {
      setStatus((e && e.message) || "Failed to load note", true);
      return;
    }
    if (!note) {
      setStatus("Note not found: " + slug, true);
      return;
    }
    setStatus("");
    setBadge(null);

    var scope = note.scope || {};
    var title = scope.osis || slug.toUpperCase();
    var bodyHtml;
    if (note.encrypted || note.cipher) {
      bodyHtml =
        '<p class="muted" data-testid="note-sealed">This note is locked. Unlock isn’t available here yet.</p>';
    } else {
      bodyHtml = outlineHtml(note.blocks || []);
    }

    var atts = note.attachments || [];
    var attHtml = "";
    if (atts.length) {
      var rows = [];
      for (var i = 0; i < atts.length; i++) {
        var a = atts[i];
        if (a.kind === "url") {
          rows.push(
            '<li class="att-row" data-testid="att-url">' +
              '<span class="att-icon" aria-hidden="true">↗</span>' +
              '<a class="attlink" href="' +
              esc(a.url) +
              '" target="_blank" rel="noopener noreferrer">' +
              esc(a.title || a.url) +
              "</a></li>"
          );
        } else if (a.kind === "file" && a.sha256) {
          rows.push(
            '<li class="att-row" data-sha="' +
              esc(a.sha256) +
              '" data-testid="att-file-' +
              esc(a.sha256.slice(0, 8)) +
              '">' +
              '<span class="att-icon" aria-hidden="true">□</span>' +
              '<button type="button" class="attlink local-att-open" data-sha="' +
              esc(a.sha256) +
              '" data-name="' +
              esc(a.name || "file") +
              '">' +
              esc(a.name || "file") +
              "</button>" +
              (a.bytes != null
                ? '<span class="att-meta">' + esc(fmtSize(a.bytes)) + "</span>"
                : "") +
              "</li>"
          );
        }
      }
      attHtml =
        '<div class="att-board local-atts" data-testid="note-attachments">' +
        '<ul class="att-list">' +
        rows.join("") +
        "</ul></div>";
    }

    el.app.innerHTML =
      '<div class="local-page local-note-page" data-testid="local-note">' +
      '<header class="local-page-head local-note-head">' +
      '<a href="#" class="local-back muted" id="local-back" data-testid="local-back">← Notes</a>' +
      '<h1 data-testid="note-title">' +
      esc(title) +
      "</h1>" +
      '<p class="muted local-pack-sub">View only</p>' +
      "</header>" +
      '<section class="local-note-body">' +
      bodyHtml +
      attHtml +
      "</section>" +
      "</div>";

    document.getElementById("local-back").addEventListener("click", function (e) {
      e.preventDefault();
      renderHome();
    });

    el.app.querySelectorAll(".local-att-open").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        var sha = btn.getAttribute("data-sha");
        var name = btn.getAttribute("data-name") || "file";
        setStatus("Loading attachment…");
        try {
          var file = await store.getAttachment(sha);
          if (!file) {
            setStatus("Attachment blob missing", true);
            return;
          }
          var url = URL.createObjectURL(file);
          blobUrls.push(url);
          setStatus("");
          var a = document.createElement("a");
          a.href = url;
          a.download = name;
          a.target = "_blank";
          a.rel = "noopener";
          a.click();
          btn.setAttribute("data-blob-url", url);
          btn.dataset.loaded = "1";
        } catch (e) {
          setStatus((e && e.message) || "Attachment failed", true);
        }
      });
    });
  }

  window.KeyverseLocalMount = {
    getStore: function () {
      return store;
    },
    getView: function () {
      return view;
    },
    getSlug: function () {
      return currentSlug;
    },
    renderLanding: renderLanding,
    mountStore: mountStore,
    openNote: openNote,
    renderHome: renderHome,
    seedAndMount: async function (pathMap, opts) {
      var s = await KeyversePackStore.seedOpfsPackAndOpen(pathMap, opts || {});
      await mountStore(s);
      return s;
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      renderLanding();
    });
  } else {
    renderLanding();
  }
})();
