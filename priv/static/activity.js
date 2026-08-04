/**
 * Contribution graph + day detail (GET /api/activity).
 * Day events are simple expandable cards; body shows a plain outline line-diff.
 */
(function () {
  "use strict";

  var BASE = window.BASE || "";
  var graphEl = document.getElementById("activity-graph");
  var leadEl = document.getElementById("activity-lead");
  var daySec = document.getElementById("activity-day");
  var dayTitle = document.getElementById("activity-day-title");
  var dayBody = document.getElementById("activity-day-body");
  var dayClose = document.getElementById("activity-day-close");
  var selectedDate = null;

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

  function formatDayLabel(iso) {
    try {
      var d = parseBackendTime(iso);
      if (!d) return iso;
      return d.toLocaleDateString(undefined, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch (e) {
      return iso;
    }
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

  function showTip(btn, text) {
    var tip = ensureTip();
    tip.textContent = text;
    tip.hidden = false;
    var rect = btn.getBoundingClientRect();
    var tw = tip.offsetWidth || 120;
    var th = tip.offsetHeight || 28;
    var left = rect.left + rect.width / 2 - tw / 2;
    var top = rect.top - th - 8;
    // Keep on screen
    left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
    if (top < 8) top = rect.bottom + 8;
    tip.style.left = left + "px";
    tip.style.top = top + "px";
  }

  function hideTip() {
    var tip = document.getElementById("activity-tip");
    if (tip) tip.hidden = true;
  }

  /** GitHub-style: columns = weeks, rows = Sun–Sat; month labels on top */
  function renderGraph(data) {
    if (!graphEl) return;
    var cells = data.days || [];
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

    // Month label for the first in-range day of each week; blank if same month as previous label
    var monthHtml = '<div class="ag-months" aria-hidden="true">';
    var lastMonthKey = null;
    for (var w = 0; w < weeks.length; w++) {
      var mLabel = "";
      for (var r = 0; r < 7; r++) {
        var day = weeks[w][r];
        if (day.empty) continue;
        var mk = day.date.slice(0, 7); // YYYY-MM
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
        var sel = selectedDate === c.date ? " is-selected" : "";
        var level = c.empty ? 0 : c.level | 0;
        var tip = cellTipText(c);
        html +=
          '<button type="button" class="ag-cell' +
          out +
          sel +
          '" data-level="' +
          level +
          '" data-date="' +
          esc(c.date) +
          '" data-count="' +
          (c.count | 0) +
          '" data-tip="' +
          esc(tip) +
          '" aria-label="' +
          esc(tip) +
          '"' +
          (c.empty ? " disabled" : "") +
          "></button>";
      }
      html += "</div>";
    }
    html += "</div></div>";
    graphEl.innerHTML = html;

    graphEl.querySelectorAll(".ag-cell[data-date]:not([disabled])").forEach(function (btn) {
      btn.addEventListener("click", function () {
        hideTip();
        openDay(btn.getAttribute("data-date"));
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
    // Hide tip when scrolling the graph strip
    var wrap = document.getElementById("activity-graph-wrap");
    if (wrap && !wrap._tipScrollBound) {
      wrap.addEventListener("scroll", hideTip, { passive: true });
      wrap._tipScrollBound = true;
    }

    // Graph is left-aligned to ~1 year ago; activity is usually on the right.
    // Scroll so the latest week (or selected day) is in view.
    scrollGraphToDate(selectedDate || last);

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

  /** Keep the target day (or right edge) visible in the horizontal graph strip. */
  function scrollGraphToDate(iso) {
    var wrap = document.getElementById("activity-graph-wrap");
    if (!wrap) return;
    var btn =
      (iso && graphEl && graphEl.querySelector('.ag-cell[data-date="' + iso + '"]')) ||
      (graphEl && graphEl.querySelector(".ag-week:last-child .ag-cell:not(.ag-out)"));
    if (!btn) {
      // fallback: pin to end
      wrap.scrollLeft = wrap.scrollWidth;
      return;
    }
    var wr = wrap.getBoundingClientRect();
    var br = btn.getBoundingClientRect();
    // Center the week column if possible
    var delta = br.left + br.width / 2 - (wr.left + wr.width / 2);
    wrap.scrollLeft = Math.max(0, wrap.scrollLeft + delta);
  }

  /**
   * Outline text from the server uses 2 spaces per indent level
   * (Keyverse.Activity.outline_text). Parse into { indent, text }.
   */
  function parseOutlineLines(text) {
    var raw = String(text || "").split("\n");
    // Drop trailing blanks (outliner caret line)
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

  /** Block-level LCS unified diff on outline rows. */
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

  /** One outline row: +/- rail · bullet · text (reader-style indent). */
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

  /**
   * Preview the outline with unified diff coloring.
   * Single-row diffs stay flat (no nested bordered panel).
   */
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

  function openDay(date) {
    selectedDate = date;
    if (graphEl) {
      graphEl.querySelectorAll(".ag-cell.is-selected").forEach(function (el) {
        el.classList.remove("is-selected");
      });
      var btn = graphEl.querySelector('.ag-cell[data-date="' + date + '"]');
      if (btn) {
        btn.classList.add("is-selected");
        scrollGraphToDate(date);
      }
    }
    if (daySec) daySec.hidden = false;
    if (dayTitle) dayTitle.textContent = formatDayLabel(date);
    if (dayBody) dayBody.innerHTML = '<p class="muted">Loading…</p>';

    fetch(BASE + "/api/activity?date=" + encodeURIComponent(date), { credentials: "same-origin" })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        renderDay(data);
      })
      .catch(function () {
        if (dayBody) dayBody.innerHTML = '<p class="login-error">Couldn’t load that day.</p>';
      });
  }

  function renderDay(data) {
    if (!dayBody) return;
    var events = data.events || [];
    if (!events.length) {
      dayBody.innerHTML = '<p class="muted">No changes this day.</p>';
      return;
    }

    var html = '<ul class="activity-event-list">';
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      var canExpand = !e.encrypted && (e.has_diff || !!e.after_text);
      var openFirst = i === 0 && canExpand;
      var noteHref = esc(BASE) + "/note/" + esc(e.slug);
      var meta =
        esc(formatTime(e.at)) + (e.summary ? " · " + esc(e.summary) : "");

      html += '<li class="activity-event' + (openFirst ? " is-open" : "") + '">';

      if (canExpand) {
        html +=
          '<button type="button" class="activity-event-toggle" aria-expanded="' +
          (openFirst ? "true" : "false") +
          '" data-idx="' +
          i +
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

      html += '<div class="activity-event-body"' + (openFirst || !canExpand ? "" : " hidden") + ">";

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
        '<a class="activity-event-open" href="' +
        noteHref +
        '">Open note</a>';
      html += "</div></li>";
    }
    html += "</ul>";
    dayBody.innerHTML = html;

    dayBody.querySelectorAll(".activity-event-toggle").forEach(function (btn) {
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

  if (dayClose) {
    dayClose.addEventListener("click", function () {
      selectedDate = null;
      if (daySec) daySec.hidden = true;
      if (graphEl) {
        graphEl.querySelectorAll(".ag-cell.is-selected").forEach(function (el) {
          el.classList.remove("is-selected");
        });
      }
    });
  }

  // YTD heatmap (Jan 1 → today); open today by default
  fetch(BASE + "/api/activity", { credentials: "same-origin" })
    .then(function (r) {
      return r.json();
    })
    .then(function (data) {
      renderGraph(data);
      var today = data.ytd_to || data.to;
      if (today) openDay(today);
    })
    .catch(function () {
      if (leadEl) leadEl.textContent = "Couldn’t load activity.";
    });
})();
