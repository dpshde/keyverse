/**
 * keyverse platform flags + appearance (light / dark / system).
 * Theme boot is also inlined in page head for FOUC; this file exposes KV_THEME API.
 *
 * Home control: single #theme-toggle button that cycles system → light → dark.
 */
(function () {
  var KEY = "kv.theme";
  var PAPER = { light: "#f6f5f2", dark: "#121211" };
  var ORDER = ["system", "light", "dark"];
  /** Phosphor class per preference (current state) */
  var ICO = {
    system: "ph-circle-half",
    light: "ph-sun",
    dark: "ph-moon",
  };
  var LABEL = {
    system: "Appearance: System",
    light: "Appearance: Light",
    dark: "Appearance: Dark",
  };

  function parsePref(raw) {
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
    return "system";
  }

  function systemDark() {
    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch (e) {
      return false;
    }
  }

  function resolve(pref) {
    pref = parsePref(pref);
    if (pref === "light" || pref === "dark") return pref;
    return systemDark() ? "dark" : "light";
  }

  function setMetaThemeColor(hex) {
    try {
      var metas = document.querySelectorAll('meta[name="theme-color"]');
      if (!metas.length) {
        var m = document.createElement("meta");
        m.setAttribute("name", "theme-color");
        m.setAttribute("content", hex);
        document.head.appendChild(m);
        return;
      }
      for (var i = 0; i < metas.length; i++) {
        metas[i].setAttribute("content", hex);
        metas[i].removeAttribute("media");
      }
    } catch (e) {
      /* ignore */
    }
  }

  function syncToggle(pref) {
    pref = parsePref(pref);
    var btn = document.getElementById("theme-toggle");
    if (!btn) return;
    var ico = btn.querySelector(".ph") || btn.querySelector("i");
    if (ico) {
      ico.className = "ph " + (ICO[pref] || ICO.system);
      ico.setAttribute("aria-hidden", "true");
    }
    var label = LABEL[pref] || LABEL.system;
    btn.setAttribute("aria-label", label);
    btn.setAttribute("title", label + " — click to change");
    btn.setAttribute("data-theme-pref", pref);
  }

  function apply(pref) {
    pref = parsePref(pref);
    var resolved = resolve(pref);
    var root = document.documentElement;
    root.dataset.theme = resolved;
    root.dataset.themePref = pref;
    root.style.colorScheme = resolved;
    setMetaThemeColor(PAPER[resolved] || PAPER.light);
    syncToggle(pref);

    // Legacy segmented control (if any page still has it)
    var seg = document.getElementById("theme-seg");
    if (seg) {
      var buttons = seg.querySelectorAll("button[data-theme-pref]");
      for (var i = 0; i < buttons.length; i++) {
        var b = buttons[i];
        var on = b.getAttribute("data-theme-pref") === pref;
        b.setAttribute("aria-pressed", on ? "true" : "false");
      }
    }
    return resolved;
  }

  function getPref() {
    try {
      return parsePref(localStorage.getItem(KEY));
    } catch (e) {
      return "system";
    }
  }

  function setPref(pref) {
    pref = parsePref(pref);
    try {
      localStorage.setItem(KEY, pref);
    } catch (e) {
      /* ignore */
    }
    return apply(pref);
  }

  function cycle() {
    var cur = getPref();
    var i = ORDER.indexOf(cur);
    if (i < 0) i = 0;
    return setPref(ORDER[(i + 1) % ORDER.length]);
  }

  // Apply immediately (may re-run after head inline boot)
  apply(getPref());

  // Follow OS when preference is system
  try {
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    var onChange = function () {
      if (getPref() === "system") apply("system");
    };
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);
  } catch (e) {
    /* ignore */
  }

  window.KV_THEME = {
    key: KEY,
    get: getPref,
    set: setPref,
    cycle: cycle,
    resolved: function () {
      return resolve(getPref());
    },
    apply: apply,
  };

  function bindToggle() {
    var btn = document.getElementById("theme-toggle");
    if (btn && btn.dataset.bound !== "1") {
      btn.dataset.bound = "1";
      btn.addEventListener("click", function (ev) {
        ev.preventDefault();
        cycle();
      });
      syncToggle(getPref());
    }

    // Legacy 3-button radio (no-op if absent)
    var seg = document.getElementById("theme-seg");
    if (seg && seg.dataset.bound !== "1") {
      seg.dataset.bound = "1";
      seg.addEventListener("click", function (ev) {
        var t = ev.target;
        if (!t || !t.getAttribute) return;
        var b = t.closest ? t.closest("button[data-theme-pref]") : null;
        if (!b) return;
        var p = b.getAttribute("data-theme-pref");
        if (p) setPref(p);
      });
      apply(getPref());
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindToggle);
  } else {
    bindToggle();
  }

  // Platform flags
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
