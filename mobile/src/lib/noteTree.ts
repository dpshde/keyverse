import type { Note } from "../api/types";
import { bookLabel, displayScope } from "./resolveLocal";

export type TreeLeaf = {
  type: "note";
  id: string;
  slug: string;
  label: string;
  kind: string;
  note: Note;
  preview: string;
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

/** Group notes into book → chapter folders with natural-language labels. */
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

function noteToLeaf(n: Note): TreeLeaf {
  const slug = n.scope?.slug || n.id;
  const blocks = n.blocks || [];
  const preview = n.encrypted
    ? ""
    : blocks
        .map((b) => (b.text || "").trim())
        .filter(Boolean)
        .slice(0, 3)
        .join(" · ");
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
    preview,
    encrypted: !!n.encrypted,
    attCount: (n.attachments || []).length,
  };
}
