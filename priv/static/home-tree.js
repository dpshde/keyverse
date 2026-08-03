/* Home note tree — fold via title row; RN CountPill (not chevrons) signals state */
(function () {
  var root = document.getElementById("note-tree");
  if (!root) return;
  var KEY =
    "vp_home_fold_" +
    (typeof BASE === "string" ? BASE : location.pathname.split("/")[1] || "local");

  function load() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "{}") || {};
    } catch (e) {
      return {};
    }
  }
  function save(map) {
    try {
      localStorage.setItem(KEY, JSON.stringify(map));
    } catch (e) {}
  }

  function setExpanded(node, expanded) {
    node.classList.toggle("is-collapsed", !expanded);
    var fold = node.querySelector(":scope > .note-row .nt-fold");
    if (!fold) return;
    fold.setAttribute("aria-expanded", expanded ? "true" : "false");
    // State also carried visually by .nt-count pill vs plain number
    var hint = expanded ? "Collapse section" : "Expand section";
    fold.setAttribute("aria-label", hint);
    fold.setAttribute("title", hint);
  }

  function toggleNode(node) {
    if (!node || !node.querySelector(":scope > .nt-kids")) return;
    var id = node.getAttribute("data-id");
    var nowCollapsed = !node.classList.contains("is-collapsed");
    setExpanded(node, !nowCollapsed);
    var map = load();
    if (nowCollapsed) map[id] = 1;
    else delete map[id];
    save(map);
  }

  // Restore persisted folds
  var collapsed = load();
  root.querySelectorAll(".nt-node").forEach(function (node) {
    var id = node.getAttribute("data-id");
    if (!id || !collapsed[id]) return;
    if (!node.querySelector(":scope > .nt-kids")) return;
    setExpanded(node, false);
  });

  root.addEventListener("click", function (e) {
    if (e.target.closest(".nt-act")) return; // edit / read icons
    // Full structure row is the fold control (padding lives on .nt-fold)
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

  root.addEventListener("keydown", function (e) {
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
})();

