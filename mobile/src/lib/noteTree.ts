import type { Note } from "../api/types";
import { localDateKey, parseBackendTime } from "./activity";
import { bookLabel, displayScope } from "./resolveLocal";

/** Notes loaded per page in Inbox (flat, newest-created first). */
export const INBOX_PAGE_SIZE = 25;

/** Day bucket for Inbox separators (only days that have notes). */
export type InboxDaySection = {
  /** Local YYYY-MM-DD, or `"unknown"` when created_at is missing */
  dateKey: string;
  label: string;
  leaves: TreeLeaf[];
};

export type TreeLeaf = {
  type: "note";
  id: string;
  slug: string;
  label: string;
  kind: string;
  note: Note;
  encrypted: boolean;
  attCount: number;
};

export type TreeFolder = {
  type: "folder";
  id: string;
  /** Display title (book: "Hebrews"; chapter: "Chapter 8") */
  label: string;
  /** Longer label for a11y when display is shortened */
  accessibilityLabel?: string;
  /** book | chapter — drives list density */
  level: "book" | "chapter";
  kids: TreeNode[];
  /** Descendant note count (not just direct kids) */
  noteCount: number;
};

export type TreeNode = TreeFolder | TreeLeaf;

function countNotes(nodes: TreeNode[]): number {
  let n = 0;
  for (const node of nodes) {
    if (node.type === "note") n += 1;
    else n += node.noteCount;
  }
  return n;
}

/**
 * Group notes into book → chapter folders with natural-language labels.
 * Kept for tooling / future surfaces; home uses Inbox only.
 */
export function buildNoteTree(notes: Note[]): TreeNode[] {
  type BookMap = Map<string, Map<string, Note[]>>;
  const books: BookMap = new Map();
  const loose: Note[] = [];

  for (const n of notes) {
    // Prefer slug (canonical lower) so folder keys stay stable
    const ref = n.scope?.slug || n.scope?.osis || "";
    const parts = ref.replace(/\s+/g, "").split(".");
    if (parts.length < 2) {
      loose.push(n);
      continue;
    }
    const book = parts[0].toLowerCase();
    const chapter = String(Number(parts[1]) || parts[1]);
    if (!books.has(book)) books.set(book, new Map());
    const ch = books.get(book)!;
    if (!ch.has(chapter)) ch.set(chapter, []);
    ch.get(chapter)!.push(n);
  }

  const bookKeys = [...books.keys()].sort((a, b) =>
    bookLabel(a).localeCompare(bookLabel(b), undefined, { numeric: true })
  );
  const roots: TreeNode[] = [];

  for (const book of bookKeys) {
    const chMap = books.get(book)!;
    const chKeys = [...chMap.keys()].sort((a, b) => Number(a) - Number(b));
    // Always natural language — e.g. "1 Samuel", never "1SA"
    const name = bookLabel(book);
    const kids: TreeNode[] = chKeys.map((ch) => {
      const list = chMap.get(ch)!;
      const leaves: TreeLeaf[] = list
        .slice()
        .sort((a, b) =>
          (a.scope?.slug || "").localeCompare(b.scope?.slug || "", undefined, { numeric: true })
        )
        .map(noteToLeaf);
      return {
        type: "folder" as const,
        id: `ch:${book}.${ch}`,
        // Nested under the book — don't repeat "Hebrews 8"
        label: `Chapter ${ch}`,
        accessibilityLabel: `${name} ${ch}`,
        level: "chapter" as const,
        kids: leaves,
        noteCount: leaves.length,
      };
    });
    roots.push({
      type: "folder",
      id: `book:${book}`,
      label: name,
      accessibilityLabel: name,
      level: "book",
      kids,
      noteCount: countNotes(kids),
    });
  }

  for (const n of loose) roots.push(noteToLeaf(n));
  return roots;
}

/**
 * Flat note list for Inbox — no book/chapter folders.
 * Newest **created** first. Uses backend/pack `created_at` only —
 * never `updated_at` (import/sync rewrites that stamp).
 */
export function buildInboxLeaves(notes: Note[]): TreeLeaf[] {
  return notes
    .map(noteToLeaf)
    .sort((a, b) => {
      const ka = noteCreatedKey(a.note);
      const kb = noteCreatedKey(b.note);
      if (!ka && !kb) return 0;
      if (!ka) return 1; // missing created_at → bottom
      if (!kb) return -1;
      return kb.localeCompare(ka);
    });
}

/**
 * Inbox notes grouped by local calendar day of `created_at`.
 * Only days that have notes (empty days are never emitted).
 * Day order follows newest-created-first within the flat list.
 */
export function buildInboxDaySections(notes: Note[]): InboxDaySection[] {
  const leaves = buildInboxLeaves(notes);
  const order: string[] = [];
  const byDay = new Map<string, TreeLeaf[]>();
  for (const leaf of leaves) {
    const key = noteCreatedLocalDay(leaf.note);
    if (!byDay.has(key)) {
      byDay.set(key, []);
      order.push(key);
    }
    byDay.get(key)!.push(leaf);
  }
  return order.map((dateKey) => ({
    dateKey,
    label: formatInboxDayLabel(dateKey),
    leaves: byDay.get(dateKey)!,
  }));
}

/**
 * Flatten day sections into list rows with a header before each non-empty day.
 * `limit` caps **notes** (headers don't count toward the page size).
 */
export function flattenInboxWithDayHeaders(
  sections: InboxDaySection[],
  limit: number
): { kind: "day" | "note"; dayKey?: string; dayLabel?: string; leaf?: TreeLeaf; key: string }[] {
  const out: {
    kind: "day" | "note";
    dayKey?: string;
    dayLabel?: string;
    leaf?: TreeLeaf;
    key: string;
  }[] = [];
  let notesShown = 0;
  for (const sec of sections) {
    if (notesShown >= limit) break;
    const remaining = limit - notesShown;
    const slice = sec.leaves.slice(0, remaining);
    if (!slice.length) continue;
    out.push({
      kind: "day",
      dayKey: sec.dateKey,
      dayLabel: sec.label,
      key: `day:${sec.dateKey}`,
    });
    for (const leaf of slice) {
      out.push({ kind: "note", leaf, key: `inbox:${leaf.id}` });
      notesShown += 1;
    }
  }
  return out;
}

/** ISO `created_at` for Inbox ordering (pack/door stamp). */
export function noteCreatedKey(n: Note): string {
  return (n.created_at || "").trim();
}

/** Local calendar day key for a note's created_at (user timezone). */
export function noteCreatedLocalDay(n: Note): string {
  const raw = noteCreatedKey(n);
  if (!raw) return "unknown";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = parseBackendTime(raw);
  if (!d) {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
    return m ? m[1] : "unknown";
  }
  return localDateKey(d);
}

/** "Today" · "Yesterday" · "Tuesday · Aug 4" for Inbox day rails. */
export function formatInboxDayLabel(dateKey: string): string {
  if (dateKey === "unknown") return "Unknown date";
  try {
    const [y, m, d] = dateKey.split("-").map(Number);
    const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
    const today = localDateKey(new Date());
    const yest = (() => {
      const t = new Date();
      t.setDate(t.getDate() - 1);
      return localDateKey(t);
    })();
    if (dateKey === today) return "Today";
    if (dateKey === yest) return "Yesterday";
    const weekday = dt.toLocaleDateString(undefined, { weekday: "long" });
    const rest = dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    // Include year when not this calendar year
    if (y !== new Date().getFullYear()) {
      return `${weekday} · ${rest}, ${y}`;
    }
    return `${weekday} · ${rest}`;
  } catch {
    return dateKey;
  }
}

function noteToLeaf(n: Note): TreeLeaf {
  const slug = n.scope?.slug || n.id;
  // Preview body is rendered from note.blocks (indent + newlines) via OutlinePreview —
  // never flatten text and drop indent (that was the old home-card bug).
  const label = n.scope
    ? displayScope(n.scope)
    : (() => {
        // Best-effort from slug when scope missing
        const m = /^([1-3]?[a-z]+)\.(\d+)(?:\.(\d+)(?:-(\d+))?)?$/i.exec(slug);
        if (!m) return slug;
        const book = m[1].toLowerCase();
        const ch = m[2];
        const v1 = m[3];
        const v2 = m[4];
        const name = bookLabel(book);
        if (v1 && v2) return `${name} ${ch}:${v1}–${v2}`;
        if (v1) return `${name} ${ch}:${v1}`;
        return `${name} ${ch}`;
      })();
  return {
    type: "note",
    id: n.id || slug,
    slug,
    label,
    kind: n.scope?.kind || "note",
    note: n,
    encrypted: !!n.encrypted,
    attCount: (n.attachments || []).length,
  };
}
