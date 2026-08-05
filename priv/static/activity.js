/**
 * Contribution graph + week-by-week day folders (GET /api/activity).
 * Matches mobile: graph is YTD overview; drill-down is week nav + day folders.
 */
(function () {
  "use strict";

  var BASE = window.BASE || "";
  var graphEl = document.getElementById("activity-graph");
  var leadEl = document.getElementById("activity-lead");
  var foldersEl = document.getElementById("activity-day-folders");
  var weekTitleEl = document.getElementById("activity-week-title");
  var weekPrevBtn = document.getElementById("activity-week-prev");
  var weekNextBtn = document.getElementById("activity-week-next");
  var weekJumpBtn = document.getElementById("activity-week-jump");
  var weekPickBtn = document.getElementById("activity-week-pick");
  var weekPickerEl = document.getElementById("activity-week-picker");
  var weekPickerList = document.getElementById("activity-week-picker-list");
  var weekPickerDone = document.getElementById("activity-week-picker-done");
  var weekPickerBackdrop = document.getElementById("activity-week-picker-backdrop");

  /** @type {{ days: any[], from: string, to: string, ytd_from?: string, ytd_to?: string, notes_taken_ytd?: number, total?: number } | null} */
  var heat = null;
  /** Sunday (UTC) of the visible week */
  var weekStart = null;
  /** date → day payload | "loading" | "error" */
  var dayCache = {};
  /** date → true when expanded */
  var dayOpen = {};
  /** Element that opened the picker (for focus restore) */
  var weekPickerReturnFocus = null;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /** Backend UTC (or naive-as-UTC) → Date. Date-only keys → local calendar noon. */
  function parseBackendTime(iso) {
    if (!iso) return null;
    var raw = String(iso).trim();
    if (!raw) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      var p = raw.split("-");
      return new Date(+p[0], +p[1] - 1, +p[2], 12, 0, 0, 0);
    }
    var s = raw.indexOf("T") >= 0 ? raw : raw.replace(" ", "T");
    if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
      var t = Date.parse(s);
      return isNaN(t) ? null : new Date(t);
    }
    if (s.charAt(s.length - 1) !== "Z" && s.charAt(s.length - 1) !== "z") s = s + "Z";
    var t2 = Date.parse(s);
    return isNaN(t2) ? null : new Date(t2);
  }

  function formatTime(iso) {
    if (!iso) return "";
    try {
      var d = parseBackendTime(iso);
      if (!d) return iso;
      return d.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      });
    } catch (e) {
      return iso;
    }
  }

  function monthShort(iso) {
    try {
      return new Date(iso + "T12:00:00Z").toLocaleDateString(undefined, {
        month: "short",
        timeZone: "UTC",
      });
    } catch (e) {
      return iso.slice(5, 7);
    }
  }

  function formatTipDate(iso) {
    try {
      return new Date(iso + "T12:00:00Z").toLocaleDateString(undefined, {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
    } catch (e) {
      return iso;
    }
  }

  function cellTipText(cell) {
    var n = cell.count | 0;
    var word = n === 1 ? "change" : "changes";
    return formatTipDate(cell.date) + " · " + n + " " + word;
  }

  function ensureTip() {
    var tip = document.getElementById("activity-tip");
    if (tip) return tip;
    tip = document.createElement("div");
    tip.id = "activity-tip";
    tip.className = "activity-tip";
    tip.setAttribute("role", "tooltip");
    tip.hidden = true;
    document.body.appendChild(tip);
    return tip;
  }

  function showTip(el, text) {
    var tip = ensureTip();
    tip.textContent = text;
    tip.hidden = false;
    var rect = el.getBoundingClientRect();
    var tw = tip.offsetWidth || 120;
    var th = tip.offsetHeight || 28;
    var left = rect.left + rect.width / 2 - tw / 2;
    var top = rect.top - th - 8;
    left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
    if (top < 8) top = rect.bottom + 8;
    tip.style.left = left + "px";
    tip.style.top = top + "px";
  }

  function hideTip() {
    var tip = document.getElementById("activity-tip");
    if (tip) tip.hidden = true;
  }

  // --- week calendar helpers (UTC, matches door heat day keys) ----------------

  function addDays(iso, n) {
    var d = new Date(iso + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function weekStartOf(iso) {
    var d = new Date(iso + "T12:00:00Z");
    var dow = d.getUTCDay(); // 0 = Sun
    d.setUTCDate(d.getUTCDate() - dow);
    return d.toISOString().slice(0, 10);
  }

  function weekDates(start) {
    var out = [];
    for (var i = 0; i < 7; i++) out.push(addDays(start, i));
    return out;
  }

  /** "Aug 3 – 9" or "Dec 29 – Jan 4" */
  function formatWeekRange(start) {
    var end = addDays(start, 6);
    try {
      var a = new Date(start + "T12:00:00Z");
      var b = new Date(end + "T12:00:00Z");
      var left = a.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
      if (a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth()) {
        return left + " – " + b.getUTCDate();
      }
      var right = b.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
      return left + " – " + right;
    } catch (e) {
      return start + " – " + end;
    }
  }

  /** "Tuesday · Aug 4" */
  function formatDayFolderLabel(iso) {
    try {
      var d = new Date(iso + "T12:00:00Z");
      var weekday = d.toLocaleDateString(undefined, { weekday: "long", timeZone: "UTC" });
      var rest = d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
      return weekday + " · " + rest;
    } catch (e) {
      return iso;
    }
  }

  function formatRange(from, to) {
    try {
      var a = new Date(from + "T12:00:00Z");
      var b = new Date(to + "T12:00:00Z");
      var opts = { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" };
      return a.toLocaleDateString(undefined, opts) + " – " + b.toLocaleDateString(undefined, opts);
    } catch (e) {
      return from + " – " + to;
    }
  }

  function heatFrom() {
    return (heat && (heat.from || heat.ytd_from)) || "";
  }

  function heatTo() {
    return (heat && (heat.to || heat.ytd_to)) || "";
  }

  function todayKey() {
    return (heat && (heat.ytd_to || heat.to)) || "";
  }

  function inRange(date) {
    var from = heatFrom();
    var to = heatTo();
    return !!date && date >= from && date <= to;
  }

  function countByDate(date) {
    if (!heat || !heat.days) return 0;
    for (var i = 0; i < heat.days.length; i++) {
      if (heat.days[i].date === date) return heat.days[i].count | 0;
    }
    return 0;
  }

  function weekIntersectsRange(start) {
    var end = addDays(start, 6);
    var from = heatFrom();
    var to = heatTo();
    return end >= from && start <= to;
  }

  function canGoPrev() {
    if (!heat || !weekStart) return false;
    return weekIntersectsRange(addDays(weekStart, -7));
  }

  function canGoNext() {
    if (!heat || !weekStart) return false;
    return weekIntersectsRange(addDays(weekStart, 7));
  }

  // --- graph (overview only) -------------------------------------------------

  function renderGraph() {
    if (!graphEl || !heat) return;
    var cells = heat.days || [];
    if (!cells.length) {
      graphEl.innerHTML = "";
      return;
    }

    var byDate = {};
    for (var i = 0; i < cells.length; i++) byDate[cells[i].date] = cells[i];

    var first = cells[0].date;
    var last = cells[cells.length - 1].date;
    var start = new Date(first + "T12:00:00Z");
    var end = new Date(last + "T12:00:00Z");
    var dow = start.getUTCDay();
    var gridStart = new Date(start);
    gridStart.setUTCDate(gridStart.getUTCDate() - dow);

    var weeks = [];
    var cursor = new Date(gridStart);
    while (cursor <= end || (weeks.length && weeks[weeks.length - 1].length < 7)) {
      var week = [];
      for (var d = 0; d < 7; d++) {
        var iso = cursor.toISOString().slice(0, 10);
        week.push(byDate[iso] || { date: iso, count: 0, level: 0, empty: !byDate[iso] });
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      weeks.push(week);
      if (cursor > end && week[6].date >= last) break;
      if (weeks.length > 60) break;
    }

    var weekEnd = weekStart ? addDays(weekStart, 6) : "";

    var monthHtml = '<div class="ag-months" aria-hidden="true">';
    var lastMonthKey = null;
    for (var w = 0; w < weeks.length; w++) {
      var mLabel = "";
      for (var r = 0; r < 7; r++) {
        var day = weeks[w][r];
        if (day.empty) continue;
        var mk = day.date.slice(0, 7);
        if (mk !== lastMonthKey) {
          mLabel = monthShort(day.date);
          lastMonthKey = mk;
        }
        break;
      }
      monthHtml +=
        '<div class="ag-month-col">' +
        (mLabel ? '<span class="ag-month-lab">' + esc(mLabel) + "</span>" : "") +
        "</div>";
    }
    monthHtml += "</div>";

    var html = '<div class="ag-board">' + monthHtml + '<div class="ag-weeks">';
    for (w = 0; w < weeks.length; w++) {
      html += '<div class="ag-week">';
      for (r = 0; r < 7; r++) {
        var c = weeks[w][r];
        var out = c.empty ? " ag-out" : "";
        var inWeek =
          weekStart && c.date >= weekStart && c.date <= weekEnd ? " is-week" : "";
        var dim = !c.empty && weekStart && !(c.date >= weekStart && c.date <= weekEnd) ? " is-dim" : "";
        var level = c.empty ? 0 : c.level | 0;
        var tip = cellTipText(c);
        // Visual overview — click jumps to that week (not day-pick)
        html +=
          '<div class="ag-cell' +
          out +
          inWeek +
          dim +
          '" role="button" tabindex="' +
          (c.empty ? "-1" : "0") +
          '" data-level="' +
          level +
          '" data-date="' +
          esc(c.date) +
          '" data-count="' +
          (c.count | 0) +
          '" data-tip="' +
          esc(tip) +
          '" aria-label="' +
          esc(tip + (c.empty ? "" : " · open week")) +
          '"' +
          (c.empty ? ' aria-disabled="true"' : "") +
          "></div>";
      }
      html += "</div>";
    }
    html += "</div></div>";
    graphEl.innerHTML = html;

    graphEl.querySelectorAll(".ag-cell[data-date]:not([aria-disabled])").forEach(function (btn) {
      function activate() {
        hideTip();
        setWeekStart(weekStartOf(btn.getAttribute("data-date")));
      }
      btn.addEventListener("click", activate);
      btn.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
      });
      btn.addEventListener("mouseenter", function () {
        showTip(btn, btn.getAttribute("data-tip") || "");
      });
      btn.addEventListener("mousemove", function () {
        showTip(btn, btn.getAttribute("data-tip") || "");
      });
      btn.addEventListener("mouseleave", hideTip);
      btn.addEventListener("focus", function () {
        showTip(btn, btn.getAttribute("data-tip") || "");
      });
      btn.addEventListener("blur", hideTip);
    });

    var wrap = document.getElementById("activity-graph-wrap");
    if (wrap && !wrap._tipScrollBound) {
      wrap.addEventListener("scroll", hideTip, { passive: true });
      wrap._tipScrollBound = true;
    }

    scrollGraphToDate(weekStart || last);
  }

  function scrollGraphToDate(iso) {
    var wrap = document.getElementById("activity-graph-wrap");
    if (!wrap) return;
    var btn =
      (iso && graphEl && graphEl.querySelector('.ag-cell[data-date="' + iso + '"]')) ||
      (graphEl && graphEl.querySelector(".ag-week:last-child .ag-cell:not(.ag-out)"));
    if (!btn) {
      wrap.scrollLeft = wrap.scrollWidth;
      return;
    }
    var wr = wrap.getBoundingClientRect();
    var br = btn.getBoundingClientRect();
    var delta = br.left + br.width / 2 - (wr.left + wr.width / 2);
    wrap.scrollLeft = Math.max(0, wrap.scrollLeft + delta);
  }

  // --- week nav + day folders -----------------------------------------------

  function setWeekStart(next) {
    if (!heat || !next) return;
    if (!weekIntersectsRange(next)) return;
    weekStart = next;
    dayOpen = {};
    updateWeekNav();
    renderGraph();
    renderDayFolders();
  }

  function updateWeekNav() {
    if (!weekStart) return;
    if (weekTitleEl) weekTitleEl.textContent = formatWeekRange(weekStart);
    var isThis = weekStart === weekStartOf(todayKey());
    if (weekJumpBtn) {
      weekJumpBtn.hidden = isThis;
      weekJumpBtn.textContent = "This week";
    }
    if (weekPickBtn) {
      weekPickBtn.setAttribute(
        "aria-label",
        "Week of " + formatWeekRange(weekStart) + ". Choose week."
      );
    }
    if (weekPrevBtn) {
      weekPrevBtn.disabled = !canGoPrev();
      weekPrevBtn.classList.toggle("is-disabled", !canGoPrev());
    }
    if (weekNextBtn) {
      weekNextBtn.disabled = !canGoNext();
      weekNextBtn.classList.toggle("is-disabled", !canGoNext());
    }
  }

  /** Sunday-start weeks that intersect heat range, newest first. */
  function weekOptions() {
    if (!heat) return [];
    var from = heatFrom();
    var to = heatTo();
    if (!from || !to) return [];
    var thisWeek = weekStartOf(todayKey() || to);
    var first = weekStartOf(from);
    var cursor = weekStartOf(to);
    var out = [];
    var guard = 0;
    while (cursor >= first && guard < 80) {
      var end = addDays(cursor, 6);
      if (end >= from && cursor <= to) {
        var count = 0;
        for (var i = 0; i < 7; i++) {
          var d = addDays(cursor, i);
          if (d >= from && d <= to) count += countByDate(d);
        }
        out.push({
          start: cursor,
          end: end,
          count: count,
          isCurrent: cursor === thisWeek,
        });
      }
      cursor = addDays(cursor, -7);
      guard++;
    }
    return out;
  }

  function openWeekPicker() {
    if (!heat || !weekPickerEl || !weekPickerList) return;
    weekPickerReturnFocus = document.activeElement;
    var opts = weekOptions();
    var html = "";
    for (var i = 0; i < opts.length; i++) {
      var w = opts[i];
      var selected = w.start === weekStart;
      var word = w.count === 1 ? "change" : "changes";
      html +=
        '<button type="button" class="activity-week-picker-row' +
        (selected ? " is-selected" : "") +
        '" role="option" aria-selected="' +
        (selected ? "true" : "false") +
        '" data-week="' +
        esc(w.start) +
        '" aria-label="' +
        esc(
          formatWeekRange(w.start) +
            (w.isCurrent ? ", this week" : "") +
            ", " +
            w.count +
            " " +
            word
        ) +
        '">' +
        '<span class="activity-week-picker-row-text">' +
        '<span class="activity-week-picker-row-title">' +
        esc(formatWeekRange(w.start)) +
        "</span>" +
        (w.isCurrent
          ? '<span class="muted activity-week-picker-row-sub">This week</span>'
          : "") +
        "</span>" +
        '<span class="activity-count-pill' +
        (selected ? " is-ghost" : "") +
        '" aria-hidden="true">' +
        (w.count | 0) +
        "</span>" +
        "</button>";
    }
    if (!opts.length) {
      html = '<p class="muted activity-week-empty">No weeks in range.</p>';
    }
    weekPickerList.innerHTML = html;
    weekPickerList.querySelectorAll("[data-week]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        pickWeek(btn.getAttribute("data-week"));
      });
    });
    weekPickerEl.hidden = false;
    document.body.classList.add("activity-picker-open");
    if (weekPickBtn) weekPickBtn.setAttribute("aria-expanded", "true");
    // Focus selected row, or first row, or Done
    var focusEl =
      weekPickerList.querySelector(".activity-week-picker-row.is-selected") ||
      weekPickerList.querySelector(".activity-week-picker-row") ||
      weekPickerDone;
    if (focusEl && focusEl.focus) focusEl.focus();
  }

  function closeWeekPicker() {
    if (!weekPickerEl) return;
    weekPickerEl.hidden = true;
    document.body.classList.remove("activity-picker-open");
    if (weekPickBtn) weekPickBtn.setAttribute("aria-expanded", "false");
    if (weekPickerReturnFocus && weekPickerReturnFocus.focus) {
      try {
        weekPickerReturnFocus.focus();
      } catch (e) {
        /* ignore */
      }
    }
    weekPickerReturnFocus = null;
  }

  function pickWeek(start) {
    if (!start) return;
    setWeekStart(start);
    closeWeekPicker();
    var t = todayKey();
    if (t && start === weekStartOf(t)) {
      scrollGraphToDate(t);
    } else {
      scrollGraphToDate(start);
    }
  }

  function renderDayFolders() {
    if (!foldersEl || !weekStart) return;
    var days = weekDates(weekStart);
    var active = days.filter(function (date) {
      if (!inRange(date)) return false;
      var cached = dayCache[date];
      if (cached && cached !== "loading" && cached !== "error") {
        return (cached.events || []).length > 0;
      }
      return countByDate(date) > 0;
    });

    if (!active.length) {
      foldersEl.innerHTML =
        '<p class="muted activity-week-empty" id="activity-week-empty">No activity this week.</p>';
      return;
    }

    var today = todayKey();
    var html = "";
    for (var i = 0; i < active.length; i++) {
      var date = active[i];
      var open = !!dayOpen[date];
      var isToday = date === today;
      var cached = dayCache[date];
      var eventCount =
        cached && cached !== "loading" && cached !== "error"
          ? (cached.events || []).length
          : countByDate(date);
      var pillLabel = String(eventCount);
      var pillCls = open ? " activity-count-pill is-ghost" : " activity-count-pill";

      html +=
        '<div class="activity-day-block" data-date="' +
        esc(date) +
        '">' +
        '<button type="button" class="activity-day-folder' +
        (isToday ? " is-today" : "") +
        (open ? " is-open" : "") +
        '" aria-expanded="' +
        (open ? "true" : "false") +
        '" data-date="' +
        esc(date) +
        '">' +
        '<span class="activity-day-folder-text">' +
        '<span class="activity-day-folder-title">' +
        esc(formatDayFolderLabel(date)) +
        (isToday ? " · Today" : "") +
        "</span>" +
        "</span>" +
        '<span class="' +
        pillCls.trim() +
        '" aria-hidden="true">' +
        esc(pillLabel) +
        "</span>" +
        "</button>";

      if (open) {
        html += '<div class="activity-day-folder-body">';
        html += renderDayBody(date, cached);
        html += "</div>";
      }
      html += "</div>";
    }
    foldersEl.innerHTML = html;

    foldersEl.querySelectorAll(".activity-day-folder").forEach(function (btn) {
      btn.addEventListener("click", function () {
        toggleDay(btn.getAttribute("data-date"));
      });
    });
    bindEventToggles(foldersEl);
  }

  function renderDayBody(date, cached) {
    if (cached == null || cached === "loading") {
      return '<p class="muted activity-day-loading">Loading…</p>';
    }
    if (cached === "error") {
      return '<p class="muted login-error">Couldn’t load this day.</p>';
    }
    var events = cached.events || [];
    if (!events.length) {
      return '<p class="muted">No changes this day.</p>';
    }
    var html = '<ul class="activity-event-list">';
    for (var i = 0; i < events.length; i++) {
      // Notes start collapsed — user expands for outline diff
      html += eventCardHtml(events[i], false);
    }
    html += "</ul>";
    return html;
  }

  /**
   * Product chevron SVGs (Phosphor caret regular).
   * dir: right | down | left | up — left/up mirror the provided glyphs.
   */
  function chevSvg(dir) {
    var points =
      dir === "down" || dir === "up" ? "208 96 128 176 48 96" : "96 48 176 128 96 208";
    var transform = "";
    if (dir === "left") transform = ' transform="translate(256 0) scale(-1 1)"';
    if (dir === "up") transform = ' transform="translate(0 256) scale(1 -1)"';
    return (
      '<svg class="kv-chev" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="1em" height="1em" aria-hidden="true" focusable="false">' +
      '<polyline points="' +
      points +
      '" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"' +
      transform +
      "/>" +
      "</svg>"
    );
  }

  function eventCardHtml(e, openFirst) {
    var canExpand = !e.encrypted && (e.has_diff || !!e.after_text);
    var open = openFirst && canExpand;
    var noteHref = esc(BASE) + "/note/" + esc(e.slug);
    var meta = esc(formatTime(e.at)) + (e.summary ? " · " + esc(e.summary) : "");
    var html = '<li class="activity-event' + (open ? " is-open" : "") + '">';

    if (canExpand) {
      html +=
        '<button type="button" class="activity-event-toggle" aria-expanded="' +
        (open ? "true" : "false") +
        '">' +
        '<span class="activity-event-chev" aria-hidden="true">' +
        chevSvg(open ? "down" : "right") +
        "</span>" +
        '<span class="activity-event-head-text">' +
        '<span class="activity-event-label">' +
        esc(e.label || e.slug) +
        "</span>" +
        '<span class="muted activity-event-meta">' +
        meta +
        "</span>" +
        "</span>" +
        "</button>";
    } else {
      html +=
        '<div class="activity-event-static">' +
        '<span class="activity-event-label">' +
        esc(e.label || e.slug) +
        "</span>" +
        '<span class="muted activity-event-meta">' +
        meta +
        "</span>" +
        "</div>";
    }

    html +=
      '<div class="activity-event-body"' +
      (open || !canExpand ? "" : " hidden") +
      ">";

    if (e.encrypted) {
      html += '<p class="muted activity-event-sealed">Sealed note — content not shown.</p>';
    } else if (e.has_diff) {
      html += outlineDiffHtml(e.before_text || "", e.after_text || "");
    } else if (e.after_text) {
      html += outlineSnapshotHtml(e.after_text);
    } else {
      html += '<p class="muted activity-diff-empty">No text available.</p>';
    }

    html +=
      '<a class="activity-event-open" href="' + noteHref + '">Open note</a>';
    html += "</div></li>";
    return html;
  }

  function bindEventToggles(root) {
    root.querySelectorAll(".activity-event-toggle").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var card = btn.closest(".activity-event");
        if (!card) return;
        var open = card.classList.toggle("is-open");
        btn.setAttribute("aria-expanded", open ? "true" : "false");
        var body = card.querySelector(".activity-event-body");
        if (body) body.hidden = !open;
        var chev = btn.querySelector(".activity-event-chev");
        if (chev) chev.innerHTML = chevSvg(open ? "down" : "right");
      });
    });
  }

  function toggleDay(date) {
    if (!date || !inRange(date)) return;
    if (dayOpen[date]) {
      delete dayOpen[date];
      renderDayFolders();
      return;
    }
    dayOpen[date] = true;
    loadDay(date);
    renderDayFolders();
  }

  function loadDay(date) {
    if (dayCache[date] && dayCache[date] !== "loading" && dayCache[date] !== "error") {
      return;
    }
    dayCache[date] = "loading";
    renderDayFolders();

    fetch(BASE + "/api/activity?date=" + encodeURIComponent(date), {
      credentials: "same-origin",
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        dayCache[date] = {
          date: data.date || date,
          count: data.count | 0,
          events: data.events || [],
        };
        // If expand revealed zero events, folder list will drop the empty day
        renderDayFolders();
      })
      .catch(function () {
        dayCache[date] = "error";
        renderDayFolders();
      });
  }

  // --- outline diff (unchanged presentation) --------------------------------

  function parseOutlineLines(text) {
    var raw = String(text || "").split("\n");
    while (raw.length && String(raw[raw.length - 1]).trim() === "") raw.pop();
    if (raw.length === 1 && raw[0] === "") raw = [];
    return raw.map(function (line) {
      var m = /^( *)(.*)$/.exec(line);
      var spaces = m ? m[1].length : 0;
      var indent = Math.min(32, Math.floor(spaces / 2));
      var body = m ? m[2] : line;
      return { indent: indent, text: body };
    });
  }

  function outlineKey(block) {
    return block.indent + "\0" + block.text;
  }

  function outlineDiffRows(beforeText, afterText) {
    var a = parseOutlineLines(beforeText);
    var b = parseOutlineLines(afterText);
    var m = a.length;
    var n = b.length;
    var dp = [];
    for (var i = 0; i <= m; i++) {
      dp[i] = [];
      for (var j = 0; j <= n; j++) dp[i][j] = 0;
    }
    for (i = 1; i <= m; i++) {
      for (j = 1; j <= n; j++) {
        if (outlineKey(a[i - 1]) === outlineKey(b[j - 1])) dp[i][j] = dp[i - 1][j - 1] + 1;
        else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
    var rows = [];
    i = m;
    j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && outlineKey(a[i - 1]) === outlineKey(b[j - 1])) {
        rows.push({ t: "eq", block: a[i - 1] });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        rows.push({ t: "add", block: b[j - 1] });
        j--;
      } else {
        rows.push({ t: "del", block: a[i - 1] });
        i--;
      }
    }
    rows.reverse();
    return rows;
  }

  function outlineRowHtml(kind, block) {
    // kind: add | del | eq — no +/- rail; del = strikethrough only
    var cls = "activity-oline apd-" + kind;
    if (!(block.text && String(block.text).trim())) cls += " is-blank";
    var text = block.text && String(block.text).trim() ? esc(block.text) : "";
    var textHtml = text
      ? '<span class="activity-otxt">' + text + "</span>"
      : '<span class="activity-otxt activity-otxt-blank">(blank)</span>';
    return (
      '<div class="' +
      cls +
      '" style="--depth:' +
      (block.indent | 0) +
      '">' +
      '<span class="activity-odot" aria-hidden="true"></span>' +
      textHtml +
      "</div>"
    );
  }

  function outlineDiffHtml(before, after) {
    var rows = outlineDiffRows(before, after);
    if (!rows.length) {
      return '<p class="muted activity-diff-empty">No text change.</p>';
    }
    // No outer panel — event card frames; add/del washes are self-contained
    return (
      '<div class="activity-outline-diff outline" role="region" aria-label="Outline diff">' +
      rows
        .map(function (r) {
          return outlineRowHtml(r.t, r.block);
        })
        .join("") +
      "</div>"
    );
  }

  function outlineSnapshotHtml(text) {
    var blocks = parseOutlineLines(text);
    if (!blocks.length) {
      return '<p class="muted activity-diff-empty">Empty note.</p>';
    }
    return (
      '<div class="activity-outline-diff outline activity-outline-snap" role="region" aria-label="Note outline">' +
      blocks
        .map(function (b) {
          return outlineRowHtml("eq", b);
        })
        .join("") +
      "</div>"
    );
  }

  // --- wire nav -------------------------------------------------------------

  if (weekPrevBtn) {
    weekPrevBtn.addEventListener("click", function () {
      if (!canGoPrev()) return;
      setWeekStart(addDays(weekStart, -7));
    });
  }
  if (weekNextBtn) {
    weekNextBtn.addEventListener("click", function () {
      if (!canGoNext()) return;
      setWeekStart(addDays(weekStart, 7));
    });
  }
  if (weekJumpBtn) {
    weekJumpBtn.addEventListener("click", function () {
      var t = todayKey();
      if (!t) return;
      setWeekStart(weekStartOf(t));
      scrollGraphToDate(t);
    });
  }
  if (weekPickBtn) {
    weekPickBtn.addEventListener("click", function () {
      openWeekPicker();
    });
  }
  if (weekPickerDone) {
    weekPickerDone.addEventListener("click", closeWeekPicker);
  }
  if (weekPickerBackdrop) {
    weekPickerBackdrop.addEventListener("click", closeWeekPicker);
  }
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && weekPickerEl && !weekPickerEl.hidden) {
      e.preventDefault();
      closeWeekPicker();
    }
  });

  // --- Canon coverage map (note density by book) -----------------------------
  // Heat: min(1, 0.9 * notes/chapters) — 1 note per chapter = 90% hot.

  var canonRail = document.getElementById("canon-map-rail");
  var canonDetail = document.getElementById("canon-map-detail");
  var canonHint = document.getElementById("canon-map-hint");
  var canonSelected = null;
  var canonBooks = [];
  var canonSeamT = 929 / 1189;

  function canonHeatColor(heat) {
    var t = Math.max(0, Math.min(1, heat || 0));
    if (t <= 0) return "";
    // Olive ramp matching activity greens (0 empty → full green)
    var dark =
      document.documentElement.getAttribute("data-theme") === "dark" ||
      (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches &&
        !document.documentElement.getAttribute("data-theme"));
    if (dark) {
      // mix empty rail → bright green
      var L = 0.22 + t * 0.38;
      var C = 0.04 + t * 0.1;
      return "oklch(" + L.toFixed(3) + " " + C.toFixed(3) + " 145)";
    }
    var L2 = 0.92 - t * 0.42;
    var C2 = 0.03 + t * 0.09;
    return "oklch(" + L2.toFixed(3) + " " + C2.toFixed(3) + " 145)";
  }

  function bookAtT(t) {
    if (!canonBooks.length) return null;
    var x = Math.max(0, Math.min(1, t));
    for (var i = 0; i < canonBooks.length; i++) {
      var b = canonBooks[i];
      if (x >= b.t0 && x < b.t1) return b;
    }
    return canonBooks[canonBooks.length - 1];
  }

  function formatCanonMeta(book) {
    if (!book) return "";
    var n = book.notes | 0;
    var ch = book.chapters | 0;
    if (n === 0) return "No notes yet · " + ch + " ch";
    var noteWord = n === 1 ? "note" : "notes";
    var ratio = ch > 0 ? n / ch : 0;
    var pct = Math.round(Math.min(1, 0.9 * ratio) * 100);
    return n + " " + noteWord + " · " + ch + " ch · " + pct + "% heat";
  }

  function selectCanonBook(osis, withFocus) {
    if (!osis) return;
    canonSelected = osis;
    var book = null;
    for (var i = 0; i < canonBooks.length; i++) {
      if (canonBooks[i].osis === osis) {
        book = canonBooks[i];
        break;
      }
    }
    if (canonRail) {
      canonRail.querySelectorAll(".canon-map-book").forEach(function (btn) {
        var on = btn.getAttribute("data-osis") === osis;
        btn.classList.toggle("is-selected", on);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
      });
    }
    if (canonDetail) {
      var nameEl = canonDetail.querySelector(".canon-map-detail-name");
      var metaEl = canonDetail.querySelector(".canon-map-detail-meta");
      if (nameEl) {
        nameEl.textContent = book ? book.name : osis;
        nameEl.classList.toggle("muted", !book || !(book.notes | 0));
      }
      if (metaEl) metaEl.textContent = formatCanonMeta(book);
    }
    if (withFocus && canonRail) {
      var sel = canonRail.querySelector('.canon-map-book[data-osis="' + osis + '"]');
      if (sel) sel.focus({ preventScroll: true });
    }
  }

  function defaultCanonFocus() {
    // Prefer densest heat, else first book with notes, else Genesis
    var best = null;
    var firstWith = null;
    for (var i = 0; i < canonBooks.length; i++) {
      var b = canonBooks[i];
      if ((b.notes | 0) > 0 && !firstWith) firstWith = b;
      if ((b.notes | 0) > 0 && (!best || (b.heat || 0) > (best.heat || 0))) best = b;
    }
    return (best || firstWith || canonBooks[0] || {}).osis || null;
  }

  function renderCanonMap(canon) {
    if (!canonRail) return;
    if (!canon || !canon.books || !canon.books.length) {
      canonRail.innerHTML = "";
      if (canonHint) {
        canonHint.textContent = "No notes yet — coverage will warm books as you capture.";
      }
      if (canonDetail) {
        var n0 = canonDetail.querySelector(".canon-map-detail-name");
        var m0 = canonDetail.querySelector(".canon-map-detail-meta");
        if (n0) n0.textContent = "Canon";
        if (m0) m0.textContent = "Open a passage and write to paint the map.";
      }
      return;
    }

    canonBooks = canon.books;
    canonSeamT =
      typeof canon.testament_seam_t === "number" ? canon.testament_seam_t : 929 / 1189;

    var withNotes = canon.books_with_notes | 0;
    var totalNotes = canon.total_notes | 0;
    if (canonHint) {
      if (totalNotes === 0) {
        canonHint.textContent = "No notes yet — coverage will warm books as you capture.";
      } else {
        var bw = withNotes === 1 ? "book" : "books";
        var nw = totalNotes === 1 ? "note" : "notes";
        canonHint.textContent =
          withNotes +
          " " +
          bw +
          " · " +
          totalNotes +
          " " +
          nw +
          " · 1 note/chapter ≈ 90% heat";
      }
    }

    var html = "";
    for (var i = 0; i < canonBooks.length; i++) {
      var b = canonBooks[i];
      var span = Math.max(0, (b.t1 || 0) - (b.t0 || 0));
      var heat = b.heat || 0;
      var bg = heat > 0 ? canonHeatColor(heat) : "";
      var label =
        b.name +
        (b.notes
          ? " · " + b.notes + " note" + (b.notes === 1 ? "" : "s")
          : " · no notes");
      html +=
        '<button type="button" class="canon-map-book' +
        (heat <= 0 ? " is-empty" : "") +
        '" data-osis="' +
        esc(b.osis) +
        '" data-heat="' +
        heat +
        '" style="left:' +
        (b.t0 * 100).toFixed(4) +
        "%;width:" +
        (span * 100).toFixed(4) +
        "%;" +
        (bg ? "background:" + bg + ";" : "") +
        '" title="' +
        esc(label) +
        '" aria-label="' +
        esc(label) +
        '" aria-pressed="false"></button>';
    }
    html +=
      '<span class="canon-map-seam" style="left:' +
      (canonSeamT * 100).toFixed(4) +
      '%" aria-hidden="true"></span>';
    canonRail.innerHTML = html;

    // Scrub + click
    var scrubbing = false;
    var suppressClick = false;

    function selectAtClientX(clientX, hapticish) {
      var rect = canonRail.getBoundingClientRect();
      if (rect.width <= 0) return;
      var book = bookAtT((clientX - rect.left) / rect.width);
      if (!book || book.osis === canonSelected) return;
      selectCanonBook(book.osis, false);
    }

    canonRail.onpointerdown = function (e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      scrubbing = true;
      suppressClick = true;
      canonRail.classList.add("is-scrubbing");
      try {
        canonRail.setPointerCapture(e.pointerId);
      } catch (err) {}
      selectAtClientX(e.clientX, true);
    };
    canonRail.onpointermove = function (e) {
      if (!scrubbing) return;
      selectAtClientX(e.clientX, true);
    };
    function endScrub(e) {
      if (!scrubbing) return;
      scrubbing = false;
      canonRail.classList.remove("is-scrubbing");
      try {
        if (canonRail.hasPointerCapture(e.pointerId)) {
          canonRail.releasePointerCapture(e.pointerId);
        }
      } catch (err2) {}
      window.setTimeout(function () {
        suppressClick = false;
      }, 0);
    }
    canonRail.onpointerup = endScrub;
    canonRail.onpointercancel = endScrub;

    canonRail.querySelectorAll(".canon-map-book").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        if (suppressClick) {
          e.preventDefault();
          suppressClick = false;
          return;
        }
        selectCanonBook(btn.getAttribute("data-osis"), false);
      });
    });

    selectCanonBook(defaultCanonFocus() || "GEN", false);
  }

  // YTD heatmap → land on this week
  fetch(BASE + "/api/activity", { credentials: "same-origin" })
    .then(function (r) {
      return r.json();
    })
    .then(function (data) {
      heat = data;
      var today = data.ytd_to || data.to;
      weekStart = weekStartOf(today || new Date().toISOString().slice(0, 10));

      var notes =
        data.notes_taken_ytd != null
          ? data.notes_taken_ytd | 0
          : data.lines_added_ytd != null
            ? data.lines_added_ytd | 0
            : data.total | 0;
      var yFrom = data.ytd_from || data.from;
      var yTo = data.ytd_to || data.to;
      var noteWord = notes === 1 ? "note" : "notes";
      var range = formatRange(yFrom, yTo);
      // Stacked hierarchy under title: weighted stat, then muted range
      if (leadEl) {
        leadEl.innerHTML =
          '<span class="activity-lead-stat">' +
          '<span class="activity-lead-n">' +
          notes +
          "</span> " +
          noteWord +
          " taken YTD</span>" +
          '<span class="activity-lead-range">' +
          esc(range) +
          "</span>";
      }
      if (graphEl) {
        graphEl.setAttribute(
          "aria-label",
          "Note activity overview. " + notes + " " + noteWord + " taken YTD. " + range
        );
      }

      updateWeekNav();
      renderGraph();
      renderCanonMap(data.canon);
      renderDayFolders();
    })
    .catch(function () {
      if (leadEl) {
        leadEl.innerHTML =
          '<span class="activity-lead-stat login-error">Couldn’t load activity.</span>';
      }
      if (foldersEl) {
        foldersEl.innerHTML =
          '<p class="muted login-error">Couldn’t load activity.</p>';
      }
    });
})();
