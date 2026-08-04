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
  var weekBadgeEl = document.getElementById("activity-week-badge");

  /** @type {{ days: any[], from: string, to: string, ytd_from?: string, ytd_to?: string, notes_taken_ytd?: number, total?: number } | null} */
  var heat = null;
  /** Sunday (UTC) of the visible week */
  var weekStart = null;
  /** date → day payload | "loading" | "error" */
  var dayCache = {};
  /** date → true when expanded */
  var dayOpen = {};

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
    if (weekBadgeEl) {
      weekBadgeEl.hidden = !isThis;
      weekBadgeEl.textContent = "This week";
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
      html += eventCardHtml(events[i], i === 0);
    }
    html += "</ul>";
    return html;
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
        '<span class="activity-event-chev" aria-hidden="true"></span>' +
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
    var cls = "activity-oline apd-" + kind;
    if (!(block.text && String(block.text).trim())) cls += " is-blank";
    var mark = kind === "add" ? "+" : kind === "del" ? "−" : "";
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
      '<span class="activity-omark" aria-hidden="true">' +
      mark +
      "</span>" +
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
    var compact = rows.length <= 2 ? " is-compact" : "";
    return (
      '<div class="activity-outline-diff outline' +
      compact +
      '" role="region" aria-label="Outline diff">' +
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
    var compact = blocks.length <= 2 ? " is-compact" : "";
    return (
      '<div class="activity-outline-diff outline activity-outline-snap' +
      compact +
      '" role="region" aria-label="Note outline">' +
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

  // YTD heatmap → land on this week
  fetch(BASE + "/api/activity", { credentials: "same-origin" })
    .then(function (r) {
      return r.json();
    })
    .then(function (data) {
      heat = data;
      var today = data.ytd_to || data.to;
      weekStart = weekStartOf(today || new Date().toISOString().slice(0, 10));

      if (leadEl) {
        var notes =
          data.notes_taken_ytd != null
            ? data.notes_taken_ytd | 0
            : data.lines_added_ytd != null
              ? data.lines_added_ytd | 0
              : data.total | 0;
        var yFrom = data.ytd_from || data.from;
        var yTo = data.ytd_to || data.to;
        var noteWord = notes === 1 ? "note" : "notes";
        leadEl.textContent =
          notes + " " + noteWord + " taken YTD · " + formatRange(yFrom, yTo);
      }

      updateWeekNav();
      renderGraph();
      renderDayFolders();
    })
    .catch(function () {
      if (leadEl) leadEl.textContent = "Couldn’t load activity.";
      if (foldersEl) {
        foldersEl.innerHTML =
          '<p class="muted login-error">Couldn’t load activity.</p>';
      }
    });
})();
