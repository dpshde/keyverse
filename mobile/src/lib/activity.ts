/**
 * Local contribution-graph activity from note timestamps.
 * When cloud is enabled, prefer the door GET /api/activity for op-level diffs.
 */
import type { Note } from "../api/types";
import { displayScope } from "./resolveLocal";

export type HeatCell = {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
};

export type ActivityHeatmap = {
  days: HeatCell[];
  total: number;
  /** Unique notes first written year-to-date (calendar year). */
  notes_taken_ytd: number;
  ytd_from: string;
  ytd_to: string;
  from: string;
  to: string;
  source: string;
};

export type ActivityEvent = {
  kind: string;
  slug: string;
  label: string;
  at: string;
  hash?: string | null;
  implicit?: boolean;
  summary: string;
  op_count?: number;
  before_text?: string | null;
  after_text?: string | null;
  encrypted?: boolean;
  has_diff?: boolean;
};

export type ActivityDay = {
  date: string;
  count: number;
  events: ActivityEvent[];
};

/**
 * Parse a backend timestamp (UTC ISO from the door / pack).
 * - Full ISO with Z or ±offset → absolute instant
 * - Naive ISO (`2026-03-15T12:00:00[.sss]`) → treat as UTC (pack convention)
 * - Date-only `YYYY-MM-DD` → local calendar noon (stable day label, no TZ shift)
 */
export function parseBackendTime(iso?: string | null): Date | null {
  if (iso == null) return null;
  const raw = String(iso).trim();
  if (!raw) return null;

  // Calendar day key — interpret as that date on the user's calendar
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-").map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d, 12, 0, 0, 0);
  }

  // Normalize space separator → T
  let s = raw.includes("T") ? raw : raw.replace(" ", "T");

  // Already has zone
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : new Date(t);
  }

  // Naive datetime from pack → UTC
  if (!s.endsWith("Z")) s = s + "Z";
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}

/** YYYY-MM-DD in the user's local timezone. */
export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Local calendar day for a backend timestamp (or date key). */
function isoDate(s?: string | null): string | null {
  if (!s) return null;
  const trimmed = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const d = parseBackendTime(trimmed);
  if (!d) {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
    return m ? m[1] : null;
  }
  return localDateKey(d);
}

function level(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
}

/** Add days to a local YYYY-MM-DD key (stays on local calendar). */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n, 12, 0, 0, 0);
  return localDateKey(dt);
}

/** Local calendar YTD start (Jan 1). */
export function ytdFromLocal(today = localDateKey(new Date())): string {
  return `${today.slice(0, 4)}-01-01`;
}

/** Notes created in the current local calendar year (unique notes taken). */
export function notesTakenYtdFromNotes(notes: Note[]): number {
  const today = localDateKey(new Date());
  const yFrom = ytdFromLocal(today);
  let n = 0;
  for (const note of notes) {
    const created = isoDate(note.created_at);
    if (!created || created < yFrom || created > today) continue;
    n += 1;
  }
  return n;
}

/**
 * YTD heatmap (local calendar Jan 1 → today) from note **created_at** only.
 * Never use updated_at — import/sync rewrites that and looks like a mass edit.
 */
export function heatmapFromNotes(notes: Note[]): ActivityHeatmap {
  const today = localDateKey(new Date());
  const from = ytdFromLocal(today);
  const counts = new Map<string, number>();

  for (const note of notes) {
    const date = isoDate(note.created_at);
    if (!date || date < from || date > today) continue;
    counts.set(date, (counts.get(date) || 0) + 1);
  }

  const cells: HeatCell[] = [];
  let total = 0;
  // Inclusive day count from Jan 1 → today
  const start = new Date(from + "T12:00:00");
  const end = new Date(today + "T12:00:00");
  const span = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  for (let i = 0; i < span; i++) {
    const date = addDays(from, i);
    if (date > today) break;
    const count = counts.get(date) || 0;
    total += count;
    cells.push({ date, count, level: level(count) });
  }

  return {
    days: cells,
    total,
    notes_taken_ytd: notesTakenYtdFromNotes(notes),
    ytd_from: from,
    ytd_to: today,
    from,
    to: today,
    source: "notes",
  };
}

/**
 * Lead copy + data source.
 * `ops` / `mixed` = door op log (real edit times); `notes` = stamp fallback only.
 */
export function formatYtdLead(heat: ActivityHeatmap): string {
  const n = heat.notes_taken_ytd ?? 0;
  const word = n === 1 ? "note" : "notes";
  const from = formatDayLabelShort(heat.ytd_from || heat.from);
  const to = formatDayLabelShort(heat.ytd_to || heat.to);
  const src =
    heat.source === "ops"
      ? " · edit history"
      : heat.source === "mixed"
        ? " · edits + notes"
        : " · note stamps only";
  return `${n} ${word} taken YTD · ${from} – ${to}${src}`;
}

function formatDayLabelShort(iso: string): string {
  const d = parseBackendTime(iso);
  if (!d) return iso;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Local day detail — notes **created** that day (created_at only).
 * updated_at is ignored (import/mirror pollution).
 */
export function dayFromNotes(notes: Note[], date: string): ActivityDay {
  const events: ActivityEvent[] = [];

  for (const note of notes) {
    const slug = note.scope?.slug || "";
    if (!slug) continue;
    const label = displayScope(note.scope) || slug.toUpperCase();
    const encrypted = !!(note.encrypted || note.cipher);
    const after = encrypted ? null : outlineText(note);

    const created = isoDate(note.created_at);
    if (created !== date) continue;

    events.push({
      kind: "created",
      slug,
      label,
      at: note.created_at || date,
      summary: "Note created",
      before_text: "",
      after_text: after,
      encrypted,
      has_diff: !encrypted && !!after,
    });
  }

  events.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  return { date, count: events.length, events };
}

export function outlineText(note: Note): string {
  const blocks = note.blocks || [];
  return blocks
    .map((b) => {
      const indent = Math.max(0, b.indent | 0);
      return "  ".repeat(indent) + (b.text || "");
    })
    .join("\n");
}

/** Line-level LCS diff for outline text (RN-friendly, no Shiki). */
export type DiffRow = { type: "eq" | "add" | "del"; line: string; indent: number; text: string };

/**
 * Outline lines are stored as `"  ".repeat(indent) + text` (server + local).
 * Parse back into indent depth + body for outliner-style preview.
 */
export function parseOutlineLine(line: string): { indent: number; text: string } {
  const s = String(line ?? "");
  let i = 0;
  while (i < s.length && s[i] === " ") i++;
  return { indent: Math.floor(i / 2), text: s.slice(i) };
}

function toDiffRow(type: DiffRow["type"], line: string): DiffRow {
  const { indent, text } = parseOutlineLine(line);
  return { type, line, indent, text };
}

export function lineDiff(before: string, after: string): DiffRow[] {
  const a = String(before || "").split("\n");
  const b = String(after || "").split("\n");
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const rows: DiffRow[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      rows.push(toDiffRow("eq", a[i - 1]));
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      rows.push(toDiffRow("add", b[j - 1]));
      j--;
    } else {
      rows.push(toDiffRow("del", a[i - 1]));
      i--;
    }
  }
  rows.reverse();
  return rows;
}

/** Snapshot outline (no before) as fake “add” rows for created notes. */
export function outlineAsRows(text: string | null | undefined, type: DiffRow["type"] = "eq"): DiffRow[] {
  const lines = String(text || "").split("\n");
  // Drop trailing blanks (caret line)
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.map((line) => toDiffRow(type, line));
}

/** Weeks for GitHub-style layout (columns = weeks, rows = Sun–Sat, local calendar). */
export function weeksFromHeatmap(days: HeatCell[]): HeatCell[][] {
  if (!days.length) return [];
  const byDate = new Map(days.map((d) => [d.date, d]));
  const first = days[0].date;
  const last = days[days.length - 1].date;
  const [fy, fm, fd] = first.split("-").map(Number);
  const [ly, lm, ld] = last.split("-").map(Number);
  // Align to Sunday of the week containing `first` (local)
  const start = new Date(fy, fm - 1, fd, 12, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  const end = new Date(ly, lm - 1, ld, 12, 0, 0, 0);

  const weeks: HeatCell[][] = [];
  const cursor = new Date(start);

  while (cursor <= end || (weeks.length > 0 && weeks[weeks.length - 1].length < 7)) {
    const week: HeatCell[] = [];
    for (let r = 0; r < 7; r++) {
      const iso = localDateKey(cursor);
      week.push(byDate.get(iso) || { date: iso, count: 0, level: 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
    if (cursor > end && week[6].date >= last) break;
    if (weeks.length > 60) break;
  }
  return weeks;
}

/** Calendar day key → long label in the user's locale (local calendar). */
export function formatDayLabel(iso: string): string {
  const d = parseBackendTime(iso);
  if (!d) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Backend instant → clock time in the user's local timezone.
 * Pack / door stamps are UTC; naive ISO is treated as UTC.
 */
export function formatTime(iso?: string): string {
  const d = parseBackendTime(iso);
  if (!d) return iso ? String(iso) : "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Backend instant → short local date + time (e.g. "Mar 15, 3:42 PM"). */
export function formatLocalStamp(iso?: string): string {
  const d = parseBackendTime(iso);
  if (!d) return iso ? String(iso) : "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
