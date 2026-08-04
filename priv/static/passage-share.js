/**
 * Passage deep-link share (door-scoped).
 * Default share URL is the projected reader: {BASE}/read/{slug}
 * Optional editor link: {BASE}/note/{slug}
 *
 * Markup hooks (any page):
 *   [data-passage-share]           — primary: share/copy reader URL
 *   [data-passage-share="editor"]  — copy editor URL only
 *   data-slug on the control, or page-meta JSON { slug, display }
 */
(function () {
  function base() {
    return typeof BASE === "string" ? BASE : "";
  }

  function pageMeta() {
    var el = document.getElementById("page-meta");
    if (!el) return {};
    try {
      return JSON.parse(el.textContent || "{}");
    } catch (e) {
      return {};
    }
  }

  function slugFor(btn) {
    var s = btn && btn.getAttribute("data-slug");
    if (s) return s;
    var meta = pageMeta();
    return meta.hl_slug || meta.slug || "";
  }

  function labelFor(btn) {
    var t = btn && btn.getAttribute("data-label");
    if (t) return t;
    var meta = pageMeta();
    return meta.display || "keyverse";
  }

  function passageUrl(slug) {
    return location.origin + base() + "/read/" + encodeURIComponent(slug);
  }

  function editorUrl(slug) {
    return location.origin + base() + "/note/" + encodeURIComponent(slug);
  }

  function flash(el, msg) {
    if (!el) return;
    // Icon-only controls: never wipe glyph children — flash via attr/opacity.
    var iconOnly =
      el.hasAttribute("data-icon-only") ||
      (el.classList && el.classList.contains("head-icon-btn") && !el.querySelector(".ui-ico-txt"));
    if (iconOnly) {
      var prevTitle = el.getAttribute("title") || "";
      el.dataset.flash = "1";
      if (msg) el.setAttribute("title", msg);
      setTimeout(function () {
        el.dataset.flash = "0";
        if (prevTitle) el.setAttribute("title", prevTitle);
        else el.removeAttribute("title");
      }, 1400);
      return;
    }
    var prev = el.getAttribute("data-label-default") || el.textContent;
    if (!el.getAttribute("data-label-default")) {
      el.setAttribute("data-label-default", prev);
    }
    el.textContent = msg;
    el.dataset.flash = "1";
    setTimeout(function () {
      el.textContent = el.getAttribute("data-label-default") || prev;
      el.dataset.flash = "0";
    }, 1400);
  }

  async function copyText(url, feedbackEl) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        var ta = document.createElement("textarea");
        ta.value = url;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      flash(feedbackEl, "Copied");
    } catch (e) {
      flash(feedbackEl, "—");
      window.prompt("Copy link:", url);
    }
  }

  async function shareOrCopy(url, title, feedbackEl) {
    if (navigator.share) {
      try {
        await navigator.share({
          title: title || "keyverse",
          text: title ? title + " · keyverse" : "Scripture notes",
          url: url,
        });
        return;
      } catch (err) {
        if (err && err.name === "AbortError") return;
      }
    }
    await copyText(url, feedbackEl);
  }

  document.addEventListener("click", function (e) {
    var btn = e.target && e.target.closest && e.target.closest("[data-passage-share]");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    var slug = slugFor(btn);
    if (!slug) return;
    var mode = btn.getAttribute("data-passage-share") || "read";
    var url = mode === "editor" ? editorUrl(slug) : passageUrl(slug);
    var label = labelFor(btn);
    if (mode === "editor") {
      copyText(url, btn);
    } else {
      shareOrCopy(url, label, btn);
    }
  });
})();
