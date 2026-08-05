/* Home notes: Library tree fold + Inbox mode (flat, recent-first, paginated) */
(function () {
  var section = document.getElementById("home-notes");
  var treeRoot = document.getElementById("note-tree");
  var KEY =
    "vp_home_fold_" +
    (typeof BASE === "string" ? BASE : location.pathname.split("/")[1] || "local");
  var VIEW_KEY =
    "vp_home_view_" +
    (typeof BASE === "string" ? BASE : location.pathname.split("/")[1] || "local");

  /* ── Library fold (existing) ───────────────────────────────────── */
  function loadFold() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "{}") || {};
    } catch (e) {
      return {};
    }
  }
  function saveFold(map) {
    try {
      localStorage.setItem(KEY, JSON.stringify(map));
    } catch (e) {}
  }

  function setExpanded(node, expanded) {
    node.classList.toggle("is-collapsed", !expanded);
    var fold = node.querySelector(":scope > .note-row .nt-fold");
    if (!fold) return;
    fold.setAttribute("aria-expanded", expanded ? "true" : "false");
    var hint = expanded ? "Collapse section" : "Expand section";
    fold.setAttribute("aria-label", hint);
    fold.setAttribute("title", hint);
  }

  function toggleNode(node) {
    if (!node || !node.querySelector(":scope > .nt-kids")) return;
    var id = node.getAttribute("data-id");
    var nowCollapsed = !node.classList.contains("is-collapsed");
    setExpanded(node, !nowCollapsed);
    var map = loadFold();
    if (nowCollapsed) map[id] = 1;
    else delete map[id];
    saveFold(map);
  }

  if (treeRoot) {
    var collapsed = loadFold();
    treeRoot.querySelectorAll(".nt-node").forEach(function (node) {
      var id = node.getAttribute("data-id");
      if (!id || !collapsed[id]) return;
      if (!node.querySelector(":scope > .nt-kids")) return;
      setExpanded(node, false);
    });

    treeRoot.addEventListener("click", function (e) {
      if (e.target.closest(".nt-act")) return;
      var fold = e.target.closest(".nt-fold");
      if (!fold) {
        var row = e.target.closest(".note-row.has-kids");
        if (row) fold = row.querySelector(":scope > .nt-fold");
      }
      if (fold) {
        e.preventDefault();
        toggleNode(fold.closest(".nt-node"));
        return;
      }
      var openRead = e.target.closest(".nt-open-read");
      if (!openRead) {
        var noteRow = e.target.closest(".note-row.is-note");
        if (noteRow) openRead = noteRow.querySelector(":scope > .nt-open-read");
      }
      if (openRead) {
        var href = openRead.getAttribute("data-href");
        if (href) {
          if (e.metaKey || e.ctrlKey) window.open(href, "_blank");
          else location.href = href;
        }
      }
    });

    treeRoot.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (e.target.closest(".nt-act")) return;
      var fold = e.target.closest(".nt-fold");
      if (fold && (e.target === fold || fold.contains(e.target))) {
        e.preventDefault();
        toggleNode(fold.closest(".nt-node"));
        return;
      }
      var openRead = e.target.closest(".nt-open-read");
      if (openRead && (e.target === openRead || openRead.contains(e.target))) {
        e.preventDefault();
        var href = openRead.getAttribute("data-href");
        if (href) location.href = href;
      }
    });
  }

  /* ── Inbox open-read (cards live outside #note-tree) ───────────── */
  var inboxRoot = document.getElementById("note-inbox");
  if (inboxRoot) {
    inboxRoot.addEventListener("click", function (e) {
      if (e.target.closest(".nt-act")) return;
      var openRead = e.target.closest(".nt-open-read");
      if (!openRead) {
        var row = e.target.closest(".note-row.is-note");
        if (row) openRead = row.querySelector(":scope > .nt-open-read");
      }
      if (!openRead) return;
      var href = openRead.getAttribute("data-href");
      if (!href) return;
      if (e.metaKey || e.ctrlKey) window.open(href, "_blank");
      else location.href = href;
    });
    inboxRoot.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (e.target.closest(".nt-act")) return;
      var openRead = e.target.closest(".nt-open-read");
      if (!openRead) return;
      e.preventDefault();
      var href = openRead.getAttribute("data-href");
      if (href) location.href = href;
    });
  }

  /* ── View toggle: Library | Inbox (control lives in site foot) ─── */
  if (!section) return;

  var pageSize = parseInt(section.getAttribute("data-inbox-page") || "25", 10) || 25;
  var libraryPanel = document.getElementById("home-library");
  var inboxPanel = document.getElementById("home-inbox");
  var moreBtn = document.getElementById("inbox-more");
  var lead = document.getElementById("inbox-lead");
  var visible = pageSize;
  var viewBtns = document.querySelectorAll(".home-view-btn");

  function loadView() {
    try {
      var v = localStorage.getItem(VIEW_KEY);
      if (v === "inbox" || v === "library") return v;
    } catch (e) {}
    return "library";
  }

  function saveView(v) {
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch (e) {}
  }

  function applyInboxPage() {
    if (!inboxRoot) return;
    var cards = inboxRoot.querySelectorAll(".inbox-card");
    var total = cards.length;
    cards.forEach(function (el) {
      var i = parseInt(el.getAttribute("data-inbox-index") || "0", 10);
      el.hidden = i >= visible;
    });
    // Hide day sections that have no visible cards (empty days never rendered;
    // this covers partial pages where a day header would otherwise stand alone).
    inboxRoot.querySelectorAll(".inbox-day").forEach(function (day) {
      var any = false;
      day.querySelectorAll(".inbox-card").forEach(function (c) {
        if (!c.hidden) any = true;
      });
      day.hidden = !any;
    });
    if (moreBtn) {
      moreBtn.hidden = visible >= total;
    }
    if (lead) {
      if (total > pageSize) {
        lead.hidden = false;
        lead.textContent =
          "Showing " + Math.min(visible, total) + " of " + total;
      } else {
        lead.hidden = true;
      }
    }
  }

  function setView(mode) {
    var isInbox = mode === "inbox";
    section.setAttribute("data-view", mode);
    if (libraryPanel) libraryPanel.hidden = isInbox;
    if (inboxPanel) inboxPanel.hidden = !isInbox;
    viewBtns.forEach(function (btn) {
      var on = btn.getAttribute("data-home-view") === mode;
      btn.setAttribute("aria-selected", on ? "true" : "false");
      btn.classList.toggle("is-active", on);
    });
    if (isInbox) {
      visible = pageSize;
      applyInboxPage();
    }
    saveView(mode);
  }

  viewBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var mode = btn.getAttribute("data-home-view");
      if (mode === "library" || mode === "inbox") setView(mode);
    });
  });

  if (moreBtn) {
    moreBtn.addEventListener("click", function () {
      visible = Math.min(
        visible + pageSize,
        inboxRoot ? inboxRoot.querySelectorAll(".inbox-card").length : visible
      );
      applyInboxPage();
    });
  }

  // Restore preferred view
  setView(loadView());
})();
