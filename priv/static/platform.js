/**
 * keyverse platform flags — web mirror only (no Tauri).
 * Kept tiny so pages can opt into standalone / installed PWA chrome.
 */
(function () {
  try {
    var root = document.documentElement;
    var standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;
    if (standalone) root.classList.add("kv-standalone");
    root.dataset.platform = "web";
  } catch (e) {
    /* ignore */
  }
})();
