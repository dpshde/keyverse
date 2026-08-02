import type { Note } from "../api/types";

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
  label: string;
  kids: TreeNode[];
};

export type TreeNode = TreeFolder | TreeLeaf;

/** Group notes into book → chapter folders (home tree parity). */
export function buildNoteTree(notes: Note[]): TreeNode[] {
  type BookMap = Map<string, Map<string, Note[]>>;
  const books: BookMap = new Map();
  const loose: Note[] = [];

  for (const n of notes) {
    const osis = n.scope?.osis || n.scope?.slug || "";
    const parts = osis.split(".");
    if (parts.length < 2) {
      loose.push(n);
      continue;
    }
    const book = parts[0];
    const chapter = parts[1];
    if (!books.has(book)) books.set(book, new Map());
    const ch = books.get(book)!;
    if (!ch.has(chapter)) ch.set(chapter, []);
    ch.get(chapter)!.push(n);
  }

  const bookKeys = [...books.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const roots: TreeNode[] = [];

  for (const book of bookKeys) {
    const chMap = books.get(book)!;
    const chKeys = [...chMap.keys()].sort((a, b) => Number(a) - Number(b));
    const kids: TreeNode[] = chKeys.map((ch) => {
      const list = chMap.get(ch)!;
      const leaves: TreeLeaf[] = list
        .slice()
        .sort((a, b) => (a.scope?.slug || "").localeCompare(b.scope?.slug || ""))
        .map(noteToLeaf);
      return {
        type: "folder",
        id: `ch:${book}.${ch}`,
        label: `${book} ${ch}`,
        kids: leaves,
      };
    });
    roots.push({
      type: "folder",
      id: `book:${book}`,
      label: book,
      kids,
    });
  }

  for (const n of loose) roots.push(noteToLeaf(n));
  return roots;
}

function noteToLeaf(n: Note): TreeLeaf {
  const slug = n.scope?.slug || n.id;
  const blocks = n.blocks || [];
  const preview = n.encrypted
    ? "Encrypted"
    : blocks
        .map((b) => b.text)
        .filter(Boolean)
        .slice(0, 2)
        .join(" · ");
  return {
    type: "note",
    id: n.id || slug,
    slug,
    label: n.scope?.osis || slug,
    kind: n.scope?.kind || "note",
    note: n,
    preview,
    encrypted: !!n.encrypted,
    attCount: (n.attachments || []).length,
  };
}
