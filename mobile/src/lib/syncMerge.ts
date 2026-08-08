/**
 * Pack sync merge policy (mobile ↔ door).
 *
 * History: quietSync used to push *every* local note then pull. That overwrote
 * newer / richer web edits (e.g. nested outline lines) with stale thin local
 * copies. Recovery needed live op logs — not acceptable.
 *
 * Rules (apply per slug):
 * 1. Pending local delete → empty-PUT the door (never re-pull zombies).
 * 2. Remote only → pull.
 * 3. Local only → push (unless empty draft with no attachments — skip).
 * 4. Both: never push empty over non-empty remote (stomp guard).
 * 5. Both: never push if local is strictly thinner *and* not newer by clock
 *    (stale thin). If local is thinner *and* newer, still push (intentional edit).
 * 6. Both: LWW by `updated_at` when content is compatible.
 * 7. Equal stamps: prefer the richer outline (more non-empty lines, then chars).
 */

import type { Note } from "../api/types";

export type MergeAction = "push" | "pull" | "skip" | "delete_remote";

export type ContentScore = {
  nonempty: number;
  chars: number;
  attCount: number;
  /** No text lines and no attachments (and not sealed). */
  empty: boolean;
  encrypted: boolean;
};

/** Score plaintext outline richness. Sealed notes count as opaque content. */
export function contentScore(note: Note | null | undefined): ContentScore {
  if (!note) {
    return { nonempty: 0, chars: 0, attCount: 0, empty: true, encrypted: false };
  }
  if (note.encrypted) {
    return { nonempty: 1, chars: 1, attCount: 0, empty: false, encrypted: true };
  }
  const blocks = note.blocks || [];
  let nonempty = 0;
  let chars = 0;
  for (const b of blocks) {
    const t = (b.text || "").trim();
    if (!t) continue;
    nonempty += 1;
    chars += t.length;
  }
  const attCount = (note.attachments || []).length;
  const empty = nonempty === 0 && attCount === 0;
  return { nonempty, chars, attCount, empty, encrypted: false };
}

/** ISO-8601 timestamps compare lexicographically when well-formed. */
export function isNewer(a: string | undefined, b: string | undefined): boolean {
  const aa = a || "";
  const bb = b || "";
  if (!aa) return false;
  if (!bb) return true;
  return aa > bb;
}

export function isSameStamp(a: string | undefined, b: string | undefined): boolean {
  return (a || "") === (b || "");
}

/**
 * True when applying `local` would destroy meaningful remote outline content.
 * Used as a hard stop against empty/stale-thin pushes.
 */
export function wouldDestroyRemote(local: Note, remote: Note): boolean {
  const L = contentScore(local);
  const R = contentScore(remote);
  if (R.empty) return false;
  if (L.encrypted || R.encrypted) return false;
  // Blank over content — classic stomp (requires explicit pending-delete path)
  if (L.empty && !R.empty) return true;
  // Lost lines and most of the body
  if (L.nonempty < R.nonempty && L.chars < R.chars) return true;
  // Same/fewer lines but majority of text gone (nested child wiped, parent kept)
  if (L.nonempty <= R.nonempty && R.chars >= 40 && L.chars < R.chars * 0.5) return true;
  return false;
}

function richer(a: Note, b: Note): "a" | "b" | "tie" {
  const A = contentScore(a);
  const B = contentScore(b);
  if (A.nonempty !== B.nonempty) return A.nonempty > B.nonempty ? "a" : "b";
  if (A.chars !== B.chars) return A.chars > B.chars ? "a" : "b";
  if (A.attCount !== B.attCount) return A.attCount > B.attCount ? "a" : "b";
  return "tie";
}

/**
 * Decide merge action for one slug.
 * @param pendingDelete local tombstone waiting for empty PUT
 */
export function decideMerge(opts: {
  local?: Note | null;
  remote?: Note | null;
  pendingDelete?: boolean;
}): MergeAction {
  const { local, remote, pendingDelete } = opts;
  if (pendingDelete) return "delete_remote";

  if (!local && remote) return "pull";
  if (local && !remote) {
    // Don't clutter the door with empty caret shells
    if (contentScore(local).empty) return "skip";
    return "push";
  }
  if (!local && !remote) return "skip";

  // both present
  const loc = local!;
  const rem = remote!;

  // Never bulk-push a thinner body over richer door content.
  // Intentional line-delete goes through mirrorNoteIfCloud with X-KV-Allow-Shrink;
  // quietSync must not decide "newer thin wins" (that is how Hebrews notes died).
  if (wouldDestroyRemote(loc, rem)) {
    return "pull";
  }

  if (isNewer(loc.updated_at, rem.updated_at)) return "push";
  if (isNewer(rem.updated_at, loc.updated_at)) return "pull";

  // Equal stamps: prefer richer body (heals clock-tied forks)
  const r = richer(loc, rem);
  if (r === "a") return "push";
  if (r === "b") return "pull";
  return "skip";
}

/** Partition slugs into push / pull / delete sets. */
export function planSync(opts: {
  localBySlug: Map<string, Note>;
  remoteBySlug: Map<string, Note>;
  pendingDeletes: Set<string>;
}): { push: string[]; pull: string[]; deleteRemote: string[] } {
  const push: string[] = [];
  const pull: string[] = [];
  const deleteRemote: string[] = [];
  const all = new Set<string>([
    ...opts.localBySlug.keys(),
    ...opts.remoteBySlug.keys(),
    ...opts.pendingDeletes,
  ]);

  for (const slug of all) {
    const action = decideMerge({
      local: opts.localBySlug.get(slug),
      remote: opts.remoteBySlug.get(slug),
      pendingDelete: opts.pendingDeletes.has(slug),
    });
    if (action === "push") push.push(slug);
    else if (action === "pull") pull.push(slug);
    else if (action === "delete_remote") deleteRemote.push(slug);
  }

  push.sort();
  pull.sort();
  deleteRemote.sort();
  return { push, pull, deleteRemote };
}
