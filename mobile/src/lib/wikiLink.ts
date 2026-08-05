/**
 * Wiki-link helpers (PROTOCOL §4.1 / ADR 0009).
 *
 * Syntax: [[target]] | [[target|label]]
 * Navigation always opens the projected reader for the resolved scope.
 * - Passage only (no note file): scroll / highlight the ref.
 * - Note exists: same + expand that note tray.
 */
import type { Note, Scope } from "../api/types";
import { displayScope, resolveLocal, suggestLocal } from "./resolveLocal";

export type OpenWiki = {
  /** Index of the opening `[[` */
  start: number;
  /** End of the incomplete span (caret-friendly replace end) */
  end: number;
  /** Query inside [[… before | or caret */
  query: string;
  /** True when caret is in the label half after | */
  inLabel: boolean;
};

export type WikiSuggestItem = {
  kind: "passage" | "note";
  /** Primary row title */
  label: string;
  /** Secondary line (preview / kind) */
  detail?: string;
  /** Full replacement including brackets, e.g. [[John 3:16]] */
  insertText: string;
  /** Canonical slug when resolved */
  slug: string;
  scope?: Scope;
};

/** Split wiki inner text into target + optional display label. */
export function parseWikiInner(inner: string): { target: string; label: string | null } {
  const s = String(inner ?? "");
  const pipe = s.indexOf("|");
  if (pipe < 0) return { target: s.trim(), label: null };
  const target = s.slice(0, pipe).trim();
  const label = s.slice(pipe + 1).trim();
  return { target, label: label || null };
}

/**
 * Incomplete `[[query` at caret (not closed, not ![[).
 * Returns null when caret is not inside an open wiki target/label.
 */
export function findOpenWikiLink(text: string, caret: number): OpenWiki | null {
  const t = String(text ?? "");
  const c = Math.max(0, Math.min(caret | 0, t.length));
  // Walk left for the last `[[` not closed before caret, ignoring `![[`
  let i = c - 1;
  let openAt = -1;
  while (i >= 0) {
    if (t[i] === "]" && t[i - 1] === "]") {
      // closed wiki ends before caret — stop
      break;
    }
    if (t[i] === "[" && t[i - 1] === "[") {
      if (i - 2 >= 0 && t[i - 2] === "!") {
        i -= 2;
        continue;
      }
      openAt = i - 1;
      break;
    }
    if (t[i] === "\n") break;
    i--;
  }
  if (openAt < 0) return null;
  // Ensure no ]] between open and caret
  const between = t.slice(openAt + 2, c);
  if (between.includes("]]") || between.includes("\n")) return null;

  const pipe = between.indexOf("|");
  const inLabel = pipe >= 0;
  const query = (inLabel ? between.slice(0, pipe) : between).trimStart();
  // Still offer target completion only when caret is in the target half
  return {
    start: openAt,
    end: c,
    query: inLabel ? between.slice(0, pipe).trim() : between,
    inLabel,
  };
}

/** Human label for a closed wiki: explicit |label, else natural-language ref. */
export function wikiDisplayLabel(target: string, explicitLabel: string | null | undefined): string {
  if (explicitLabel && explicitLabel.trim()) return explicitLabel.trim();
  const r = resolveLocal(target);
  if (r.ok && r.scope) return displayScope(r.scope);
  return (target || "").trim() || "…";
}

/**
 * Resolve a wiki target for navigation.
 * Always prefers the reader route with the full scope slug (verse/range/chapter).
 */
export function resolveWikiNav(target: string): {
  ok: boolean;
  slug?: string;
  scope?: Scope;
  label?: string;
  error?: string;
} {
  const r = resolveLocal(target);
  if (!r.ok || !r.scope) {
    return { ok: false, error: r.error || "Could not parse reference" };
  }
  return {
    ok: true,
    slug: r.scope.slug,
    scope: r.scope,
    label: displayScope(r.scope),
  };
}

/** App path to open for a wiki target (projected reader). */
export function wikiReaderHref(slug: string): `/read/${string}` {
  const s = encodeURIComponent(slug.trim().toLowerCase());
  return `/read/${s}`;
}

function noteSearchBlob(n: Note): string {
  if (n.encrypted) return "";
  const parts: string[] = [];
  for (const b of n.blocks || []) {
    const t = (b.text || "").trim();
    if (t) parts.push(t);
    if (parts.join(" ").length > 4000) break;
  }
  return parts.join(" \n ");
}

function notePreview(n: Note, max = 80): string {
  if (n.encrypted) return "Encrypted";
  const blob = noteSearchBlob(n);
  if (!blob) return "Empty note";
  const one = blob.replace(/\s+/g, " ").trim();
  return one.length > max ? one.slice(0, max - 1) + "…" : one;
}

function noteHasBody(n: Note): boolean {
  if (n.encrypted) return true;
  if ((n.attachments?.length ?? 0) > 0) return true;
  return (n.blocks || []).some((b) => (b.text || "").trim().length > 0);
}

/**
 * Unified [[ suggester: passage autocomplete + pack notes (slug/label/body).
 */
export function suggestWikiTargets(
  query: string,
  notes: Note[] | null | undefined,
  limit = 8
): WikiSuggestItem[] {
  const q = (query || "").trim();
  const qLower = q.toLowerCase();
  const out: WikiSuggestItem[] = [];
  const seen = new Set<string>();

  const push = (item: WikiSuggestItem) => {
    const key = item.slug.toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(item);
  };

  // Passage channel
  if (q.length >= 1) {
    for (const s of suggestLocal(q, limit)) {
      const slug = s.canonical;
      const r = resolveLocal(s.insertText || s.label || slug);
      const scope = r.scope || {
        kind: (s.kind as Scope["kind"]) || "chapter",
        osis: slug.toUpperCase(),
        slug,
      };
      const label = r.label || displayScope(scope);
      push({
        kind: "passage",
        label,
        detail: s.kind === "chapter" ? "Chapter" : s.kind === "range" ? "Range" : "Passage",
        insertText: `[[${label}]]`,
        slug,
        scope,
      });
    }
  }

  // Note channel — existing pack notes only
  const list = notes || [];
  if (list.length) {
    type Ranked = { item: WikiSuggestItem; score: number; updated: number };
    const ranked: Ranked[] = [];

    for (const n of list) {
      const slug = (n.scope?.slug || "").toLowerCase();
      if (!slug || !noteHasBody(n)) continue;
      const label = n.scope ? displayScope(n.scope) : slug;
      const labelL = label.toLowerCase();
      const blob = noteSearchBlob(n).toLowerCase();
      let score = 0;

      if (!qLower) {
        // Empty query after [[ → recent notes
        score = 10;
      } else if (slug === qLower || labelL === qLower) {
        score = 100;
      } else if (slug.startsWith(qLower) || labelL.startsWith(qLower)) {
        score = 80;
      } else if (slug.includes(qLower) || labelL.includes(qLower)) {
        score = 60;
      } else if (blob.includes(qLower)) {
        score = 40;
      } else {
        continue;
      }

      ranked.push({
        score,
        updated: Date.parse(n.updated_at || "") || 0,
        item: {
          kind: "note",
          label,
          detail: notePreview(n),
          insertText: `[[${label}]]`,
          slug,
          scope: n.scope,
        },
      });
    }

    ranked.sort((a, b) => b.score - a.score || b.updated - a.updated);
    for (const r of ranked) {
      if (out.length >= limit) break;
      // Prefer note over pure passage for same slug
      if (seen.has(r.item.slug.toLowerCase())) {
        const idx = out.findIndex((x) => x.slug.toLowerCase() === r.item.slug.toLowerCase());
        if (idx >= 0 && out[idx].kind === "passage") {
          out[idx] = r.item;
        }
        continue;
      }
      push(r.item);
    }
  }

  return out.slice(0, limit);
}

/** Replace the open [[… span with a completed wiki link. */
export function applyWikiSuggestion(
  text: string,
  open: OpenWiki,
  item: WikiSuggestItem
): { text: string; caret: number } {
  const before = text.slice(0, open.start);
  const after = text.slice(open.end);
  // Drop a trailing partial that might have been after caret (nothing) —
  // also swallow a half-typed label if any after the open span until ]] or EOL
  let rest = after;
  const close = rest.indexOf("]]");
  if (close >= 0 && !rest.slice(0, close).includes("\n")) {
    rest = rest.slice(close + 2);
  }
  const insert = item.insertText;
  const next = before + insert + rest;
  const caret = before.length + insert.length;
  return { text: next, caret };
}
