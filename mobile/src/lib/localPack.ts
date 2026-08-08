/**
 * Local-first pack store. Notes live on device; cloud is optional mirror.
 *
 * Cold-start strategy:
 * 1. Memory cache (same session)
 * 2. Single-file list snapshot (one read) → paint home immediately
 * 3. Parallel revalidate from per-note files (source of truth)
 *
 * Individual `notes/{slug}.json` files remain the pack SoT (PROTOCOL).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import type { Attachment, Block, Note, Scope } from "../api/types";
import { newBlockId } from "../api/client";
import { resolveLocal, displayScope } from "./resolveLocal";

const META_KEY = "kv.local.meta.v1";
const NOTES_INDEX = "kv.local.notesIndex.v1";
/** Slugs deleted locally but not yet confirmed cleared on the cloud mirror. */
const PENDING_DELETES_KEY = "kv.local.pendingDeletes.v1";
/** Parallel FileSystem reads — sequential await-per-note was the cold-start bottleneck. */
const READ_CONCURRENCY = 24;
const WRITE_CONCURRENCY = 12;
/** Debounce snapshot flush so rapid autosaves don't thrash disk. */
const SNAPSHOT_DEBOUNCE_MS = 350;

/** In-memory note list — avoids re-reading every .json on each screen focus. */
let notesListCache: Note[] | null = null;
let notesBySlugCache: Map<string, Note> | null = null;
/** Bumps on any write/delete/import so UIs can skip redundant reloads. */
let notesCacheEpoch = 0;
/**
 * Generation for disk revalidate — write/delete bumps so a stale background
 * revalidate cannot repaint a note that was just removed.
 */
let packGen = 0;
/** In-memory slug index — avoids AsyncStorage round-trips on every put. */
let indexCache: string[] | null = null;
/** Coalesce concurrent cold listNotes into one load. */
let listNotesInflight: Promise<Note[]> | null = null;
let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
let revalidateInflight: Promise<void> | null = null;
/** Pending cloud deletes (memory; AsyncStorage is source across launches). */
let pendingDeletesCache: Set<string> | null = null;

/** Live note updates for reader ↔ full note (and multi-surface) sync. */
export type NoteChange =
  | { slug: string; note: Note; deleted?: false }
  | { slug: string; note: null; deleted: true };

type NoteChangeListener = (change: NoteChange) => void;
const noteChangeListeners = new Set<NoteChangeListener>();

/** Subscribe to local pack writes/deletes. Returns unsubscribe. */
export function subscribeNoteChanges(fn: NoteChangeListener): () => void {
  noteChangeListeners.add(fn);
  return () => {
    noteChangeListeners.delete(fn);
  };
}

function emitNoteChange(change: NoteChange): void {
  for (const fn of noteChangeListeners) {
    try {
      fn(change);
    } catch {
      /* ignore listener errors */
    }
  }
}

export type LocalMeta = {
  created_at: string;
  updated_at: string;
  cloud?: {
    enabled: boolean;
    host: string;
    door: string;
    last_sync_at?: string;
  };
  translation: "BSB" | "KJV";
};

export function getNotesCacheEpoch(): number {
  return notesCacheEpoch;
}

/**
 * Sync read of the in-memory notes list (no disk).
 * Null when cache is cold — UI should show empty/loading then revalidate.
 */
export function peekNotes(): Note[] | null {
  return notesListCache;
}

/** Sync read of one note from memory; null if cold or missing. */
export function peekNote(slug: string): Note | null {
  if (!slug) return null;
  return notesBySlugCache?.get(slug) ?? null;
}

/**
 * Cheap signature for “did the pack list change enough to re-render?”
 * Uses slug + updated_at so block/body edits and cloud pulls both register.
 */
export function notesFingerprint(notes: Note[]): string {
  if (!notes.length) return "0";
  let s = String(notes.length);
  for (const n of notes) {
    s += `\n${n.scope?.slug || ""}:${n.updated_at || ""}`;
  }
  return s;
}

/** Drop memory cache (next listNotes/getNote hits disk). Keeps slug index. */
export function invalidateNotesCache(): void {
  notesListCache = null;
  notesBySlugCache = null;
  notesCacheEpoch += 1;
}

/**
 * Drop memory + disk list snapshot (e.g. after replace import / clear pack).
 * Next listNotes rebuilds from per-note files.
 */
export function invalidateNotesCacheDeep(): void {
  invalidateNotesCache();
  if (snapshotTimer) {
    clearTimeout(snapshotTimer);
    snapshotTimer = null;
  }
  void FileSystem.deleteAsync(listCachePath(), { idempotent: true }).catch(() => {});
}

function sortNotes(notes: Note[]): Note[] {
  return notes.slice().sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
}

function setNotesCache(notes: Note[]) {
  const sorted = sortNotes(notes);
  notesListCache = sorted;
  notesBySlugCache = new Map();
  for (const n of sorted) {
    const s = n.scope?.slug;
    if (s) notesBySlugCache.set(s, n);
  }
}

function cacheUpsert(note: Note) {
  const slug = note.scope?.slug;
  if (!slug) {
    invalidateNotesCache();
    return;
  }
  if (!notesListCache || !notesBySlugCache) {
    // Seed memory with this note so UI isn't empty; revalidate fills the rest
    setNotesCache([note]);
    notesCacheEpoch += 1;
    emitNoteChange({ slug, note });
    scheduleListSnapshot();
    void revalidateNotesFromDisk();
    return;
  }
  notesBySlugCache.set(slug, note);
  const i = notesListCache.findIndex((n) => n.scope?.slug === slug);
  if (i >= 0) notesListCache[i] = note;
  else notesListCache.push(note);
  notesListCache = sortNotes(notesListCache);
  notesCacheEpoch += 1;
  emitNoteChange({ slug, note });
  scheduleListSnapshot();
}

function cacheRemove(slug: string) {
  const s = normalizeSlug(slug) || slug;
  if (!notesListCache || !notesBySlugCache) {
    invalidateNotesCache();
    emitNoteChange({ slug: s, note: null, deleted: true });
    // Drop disk snapshot immediately — a concurrent quietSync must not re-push
    // from a stale _list_cache that still lists this slug.
    void FileSystem.deleteAsync(listCachePath(), { idempotent: true }).catch(() => {});
    return;
  }
  notesBySlugCache.delete(s);
  if (s !== slug) notesBySlugCache.delete(slug);
  notesListCache = notesListCache.filter(
    (n) => normalizeSlug(n.scope?.slug || "") !== normalizeSlug(s)
  );
  notesCacheEpoch += 1;
  emitNoteChange({ slug: s, note: null, deleted: true });
  // Write snapshot now (not only debounced) so cold paths cannot resurrect
  if (snapshotTimer) {
    clearTimeout(snapshotTimer);
    snapshotTimer = null;
  }
  void flushListSnapshot();
}

function notesDir(): string {
  return `${FileSystem.documentDirectory}keyverse/pack/notes/`;
}

function attDir(): string {
  return `${FileSystem.documentDirectory}keyverse/pack/attachments/`;
}

/** Derived list cache — not part of the portable pack zip. */
function listCachePath(): string {
  return `${FileSystem.documentDirectory}keyverse/pack/_list_cache.v1.json`;
}

async function ensureDirs() {
  await FileSystem.makeDirectoryAsync(notesDir(), { intermediates: true }).catch(() => {});
  await FileSystem.makeDirectoryAsync(attDir(), { intermediates: true }).catch(() => {});
}

/** Bounded parallel map — keeps FS / bridge load reasonable on device. */
async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!items.length) return [];
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}

/**
 * Read JSON without a prior getInfoAsync (saves one FS round-trip per note).
 * Missing files throw → null.
 */
async function readJsonFast<T>(uri: string): Promise<T | null> {
  try {
    const t = await FileSystem.readAsStringAsync(uri);
    return JSON.parse(t) as T;
  } catch {
    return null;
  }
}

async function writeJson(uri: string, obj: unknown) {
  // Compact JSON — faster autosave on the JS thread (pretty-print not needed on device)
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(obj));
}

function scheduleListSnapshot() {
  if (snapshotTimer) clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null;
    void flushListSnapshot();
  }, SNAPSHOT_DEBOUNCE_MS);
}

async function flushListSnapshot() {
  if (!notesListCache) return;
  try {
    await ensureDirs();
    // Single-file warm cache for next cold start (not part of portable pack export)
    await FileSystem.writeAsStringAsync(
      listCachePath(),
      JSON.stringify({ v: 1, notes: notesListCache })
    );
  } catch {
    /* ignore snapshot failures */
  }
}

async function tryLoadListSnapshot(): Promise<Note[] | null> {
  try {
    const raw = await FileSystem.readAsStringAsync(listCachePath());
    const parsed = JSON.parse(raw) as { v?: number; notes?: Note[] };
    if (parsed?.v === 1 && Array.isArray(parsed.notes)) return parsed.notes;
  } catch {
    /* missing or corrupt */
  }
  return null;
}

/** Load every note file in parallel (source of truth). */
async function loadNotesFromDisk(): Promise<Note[]> {
  let slugs = await getIndex();
  if (!slugs.length) {
    // Recover index from directory when AsyncStorage was wiped or never written
    try {
      const files = await FileSystem.readDirectoryAsync(notesDir());
      slugs = files.filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -".json".length));
      if (slugs.length) await setIndex(slugs);
    } catch {
      /* empty pack */
    }
  }
  if (!slugs.length) return [];
  const loaded = await mapPool(slugs, READ_CONCURRENCY, (slug) =>
    readJsonFast<Note>(notePath(slug))
  );
  return loaded.filter((n): n is Note => !!n);
}

/**
 * Background revalidate: individual files win over the list snapshot.
 * Only notifies when the pack fingerprint actually changed.
 * Aborts if a write/delete bumped packGen while we were reading (stale scan).
 */
function revalidateNotesFromDisk(): Promise<void> {
  if (revalidateInflight) return revalidateInflight;
  const genAtStart = packGen;
  revalidateInflight = (async () => {
    try {
      const notes = await loadNotesFromDisk();
      // A put/delete landed during the scan — drop this result; caller can revalidate later
      if (genAtStart !== packGen) return;
      const nextFp = notesFingerprint(notes);
      const prevFp = notesListCache ? notesFingerprint(notesListCache) : "";
      if (nextFp === prevFp && notesListCache) {
        // Snapshot was fresh — still refresh snapshot timestamp/order if needed
        return;
      }
      if (genAtStart !== packGen) return;
      // Diff by slug so open editors only react to their note
      const prevMap = notesBySlugCache;
      setNotesCache(notes);
      notesCacheEpoch += 1;
      if (prevMap) {
        const nextSlugs = new Set<string>();
        for (const n of notes) {
          const s = n.scope?.slug;
          if (!s) continue;
          nextSlugs.add(s);
          const old = prevMap.get(s);
          if (!old || (old.updated_at || "") !== (n.updated_at || "")) {
            emitNoteChange({ slug: s, note: n });
          }
        }
        for (const s of prevMap.keys()) {
          if (!nextSlugs.has(s)) {
            emitNoteChange({ slug: s, note: null, deleted: true });
          }
        }
      } else {
        // Home (and others that ignore payload) pick up via peekNotes
        for (const n of notes.slice(0, 1)) {
          const s = n.scope?.slug;
          if (s) emitNoteChange({ slug: s, note: n });
        }
        if (!notes.length) {
          // No note payload — still bump so focus/SWR paths refresh
          emitNoteChange({ slug: "__reload__", note: null, deleted: true });
        }
      }
      scheduleListSnapshot();
    } catch {
      /* keep snapshot cache */
    } finally {
      revalidateInflight = null;
    }
  })();
  return revalidateInflight;
}

function normalizeSlug(slug: string): string {
  return (slug || "").trim().toLowerCase();
}

async function getPendingDeletes(): Promise<Set<string>> {
  if (pendingDeletesCache) return new Set(pendingDeletesCache);
  try {
    const raw = await AsyncStorage.getItem(PENDING_DELETES_KEY);
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    pendingDeletesCache = new Set(
      (Array.isArray(arr) ? arr : []).map(normalizeSlug).filter(Boolean)
    );
  } catch {
    pendingDeletesCache = new Set();
  }
  return new Set(pendingDeletesCache);
}

async function setPendingDeletes(set: Set<string>): Promise<void> {
  pendingDeletesCache = new Set([...set].map(normalizeSlug).filter(Boolean));
  await AsyncStorage.setItem(
    PENDING_DELETES_KEY,
    JSON.stringify([...pendingDeletesCache])
  );
}

/** Mark slug as deleted until cloud mirror confirms (quietSync must not resurrect). */
export async function markPendingDelete(slug: string): Promise<void> {
  const s = normalizeSlug(slug);
  if (!s) return;
  const set = await getPendingDeletes();
  set.add(s);
  await setPendingDeletes(set);
}

/** Clear pending-delete flag after successful cloud empty PUT (or local-only). */
export async function clearPendingDelete(slug: string): Promise<void> {
  const s = normalizeSlug(slug);
  if (!s) return;
  const set = await getPendingDeletes();
  if (!set.has(s)) return;
  set.delete(s);
  await setPendingDeletes(set);
}

/** All slugs waiting for cloud delete confirmation. */
export async function listPendingDeletes(): Promise<string[]> {
  return [...(await getPendingDeletes())];
}

/** True when this slug must not be re-imported from cloud. */
export async function isPendingDelete(slug: string): Promise<boolean> {
  const set = await getPendingDeletes();
  return set.has(normalizeSlug(slug));
}

export async function getMeta(): Promise<LocalMeta> {
  const raw = await AsyncStorage.getItem(META_KEY);
  if (raw) return JSON.parse(raw) as LocalMeta;
  const now = new Date().toISOString();
  const meta: LocalMeta = { created_at: now, updated_at: now, translation: "BSB" };
  await AsyncStorage.setItem(META_KEY, JSON.stringify(meta));
  return meta;
}

export async function setMeta(patch: Partial<LocalMeta>): Promise<LocalMeta> {
  const cur = await getMeta();
  const next: LocalMeta = {
    ...cur,
    ...patch,
    cloud: patch.cloud !== undefined ? patch.cloud : cur.cloud,
    updated_at: new Date().toISOString(),
  };
  await AsyncStorage.setItem(META_KEY, JSON.stringify(next));
  return next;
}

async function getIndex(): Promise<string[]> {
  if (indexCache) return indexCache.slice();
  const raw = await AsyncStorage.getItem(NOTES_INDEX);
  indexCache = raw ? (JSON.parse(raw) as string[]) : [];
  return indexCache.slice();
}

async function setIndex(slugs: string[]) {
  const uniq = [...new Set(slugs)].sort();
  indexCache = uniq;
  await AsyncStorage.setItem(NOTES_INDEX, JSON.stringify(uniq));
}

function notePath(slug: string) {
  return `${notesDir()}${slug}.json`;
}

/**
 * List all local notes (newest updated_at first).
 * Cold path: list snapshot → memory paint, then parallel file revalidate.
 */
export async function listNotes(): Promise<Note[]> {
  if (notesListCache) return notesListCache;
  if (listNotesInflight) return listNotesInflight;

  listNotesInflight = (async () => {
    try {
      await ensureDirs();
      // Another path may have warm-filled memory while we awaited dirs
      if (notesListCache) return notesListCache;

      // Fast path: one read of the derived list cache
      const snap = await tryLoadListSnapshot();
      if (notesListCache) return notesListCache;
      if (snap) {
        // Strip pending deletes so a stale snapshot cannot re-push zombies
        const pending = await getPendingDeletes();
        const filtered = pending.size
          ? snap.filter((n) => !pending.has(normalizeSlug(n.scope?.slug || "")))
          : snap;
        setNotesCache(filtered);
        // Files remain SoT — reconcile without blocking first paint
        void revalidateNotesFromDisk();
        return notesListCache!;
      }

      const notes = await loadNotesFromDisk();
      if (notesListCache) {
        // Write landed during disk scan — revalidate merges truth from files
        void revalidateNotesFromDisk();
        return notesListCache;
      }
      setNotesCache(notes);
      scheduleListSnapshot();
      return notesListCache!;
    } finally {
      listNotesInflight = null;
    }
  })();

  return listNotesInflight;
}

export async function getNote(slug: string): Promise<Note | null> {
  // Warm full cache on first access so home/reader share one in-memory set
  if (notesListCache === null || notesBySlugCache === null) {
    await listNotes();
  }
  return notesBySlugCache?.get(slug) ?? null;
}

/**
 * Bulk write notes (import / cloud pull). One index write, parallel FS, single list rebuild.
 * Much faster than N× upsertNoteRecord (each of which re-read/wrote the slug index).
 */
export async function bulkUpsertNotes(notes: Note[]): Promise<number> {
  if (!notes.length) return 0;
  await ensureDirs();
  const pending = await getPendingDeletes();
  const idx = new Set(await getIndex());
  let wrote = 0;
  /** Capture before invalidate so we can emit precise change events after rebuild. */
  const prevBySlug = notesBySlugCache ? new Map(notesBySlugCache) : null;
  const writtenSlugs: string[] = [];

  await mapPool(notes, WRITE_CONCURRENCY, async (note) => {
    const slug = note.scope?.slug;
    if (!slug) return;
    // Local delete must win over a cloud pull until the door is cleared
    if (pending.has(normalizeSlug(slug))) return;
    // Re-check: delete may have landed after we snapshot `pending`
    if (await isPendingDelete(slug)) return;
    await writeJson(notePath(slug), note);
    idx.add(slug);
    wrote += 1;
    writtenSlugs.push(slug);
  });

  if (!wrote) return 0;

  packGen += 1;
  await setIndex([...idx]);
  // Drop stale list snapshot, then rebuild from per-note files (parallel)
  invalidateNotesCacheDeep();
  await listNotes();

  // Notify UI (home/reader). QuietSync used to write files without emitting,
  // so inbox stayed stale until a full remount.
  const next = notesBySlugCache;
  if (next && writtenSlugs.length) {
    for (const slug of writtenSlugs) {
      const n = next.get(slug);
      if (!n) continue;
      const old = prevBySlug?.get(slug);
      if (!old || (old.updated_at || "") !== (n.updated_at || "")) {
        emitNoteChange({ slug, note: n });
      }
    }
  } else {
    emitNoteChange({ slug: "__bulk__", note: null, deleted: true });
  }

  return wrote;
}

/** Clear slug index in memory + AsyncStorage (after wipe / replace import). */
export async function clearNotesIndex(): Promise<void> {
  indexCache = [];
  await AsyncStorage.setItem(NOTES_INDEX, "[]");
}

function scopeFromSlug(slug: string): Scope {
  const r = resolveLocal(slug);
  if (r.ok && r.scope) return r.scope;
  const parts = slug.split(".");
  if (parts.length === 2) {
    return { kind: "chapter", osis: slug.toUpperCase(), slug };
  }
  if (parts.length >= 3 && parts[2].includes("-")) {
    return { kind: "range", osis: slug.toUpperCase(), slug };
  }
  return { kind: "verse", osis: slug.toUpperCase(), slug };
}

export async function putNote(
  slug: string,
  payload: {
    blocks?: Block[];
    attachments?: Attachment[];
    encrypted?: boolean;
    cipher?: Note["cipher"];
  }
): Promise<Note | { deleted: true; slug: string }> {
  await ensureDirs();
  // Prefer memory; avoid full-list warm when possible for single-note write path
  const existing =
    peekNote(slug) ??
    (await readJsonFast<Note>(notePath(slug))) ??
    null;
  const blocks = payload.blocks;
  const attachments =
    payload.attachments !== undefined
      ? payload.attachments
      : ((existing?.attachments || []) as Attachment[]);

  const blankBlocks =
    !blocks || !blocks.some((b) => (b.text || "").trim());
  const blankAtts = !attachments.length;
  const encrypted = !!payload.encrypted && !!payload.cipher;

  if (!encrypted && blankBlocks && blankAtts) {
    await deleteNote(slug);
    return { deleted: true, slug };
  }

  // Recreating / editing clears any pending cloud-delete tombstone
  await clearPendingDelete(slug);

  const now = new Date().toISOString();
  const note: Note = {
    id: existing?.id || `n_${slug}`,
    scope: existing?.scope || scopeFromSlug(slug),
    created_at: existing?.created_at || now,
    updated_at: now,
  };

  if (encrypted && payload.cipher) {
    note.encrypted = true;
    note.cipher = payload.cipher;
    delete note.blocks;
    // keep attachment metadata inside cipher only — protocol: ciphertext opaque
    note.attachments = [];
  } else {
    note.encrypted = false;
    note.blocks = (blocks || existing?.blocks || emptyBlocks()).map((b, i) => ({
      id: b.id || `b_${i}`,
      indent: Math.max(0, b.indent | 0),
      text: b.text || "",
      collapsed: !!b.collapsed,
    }));
    note.attachments = attachments;
    delete note.cipher;
  }

  packGen += 1;
  await writeJson(notePath(slug), note);
  const idx = await getIndex();
  if (!idx.includes(slug)) {
    idx.push(slug);
    await setIndex(idx);
  }
  await setMeta({}); // touch updated_at
  cacheUpsert(note);
  return note;
}

/**
 * Remove a note from the local pack (file + index + memory cache).
 * Marks a pending cloud delete so quietSync cannot resurrect it until the
 * door is cleared (see mirrorNoteIfCloud / flushPendingCloudDeletes).
 */
export async function deleteNote(slug: string): Promise<void> {
  const s = normalizeSlug(slug) || slug;
  await ensureDirs();
  packGen += 1;
  await markPendingDelete(s);
  // Delete primary path + any case-variant filename that might linger
  await FileSystem.deleteAsync(notePath(s), { idempotent: true }).catch(() => {});
  if (s !== slug) {
    await FileSystem.deleteAsync(notePath(slug), { idempotent: true }).catch(() => {});
  }
  const idx = (await getIndex()).filter(
    (x) => normalizeSlug(x) !== normalizeSlug(s)
  );
  await setIndex(idx);
  await setMeta({}); // touch updated_at
  cacheRemove(s);
  // Also drop alternate casing from memory if present
  if (notesBySlugCache && s !== slug) {
    notesBySlugCache.delete(slug);
    if (notesListCache) {
      notesListCache = notesListCache.filter(
        (n) => normalizeSlug(n.scope?.slug || "") !== normalizeSlug(s)
      );
    }
  }
}

export async function upsertNoteRecord(note: Note): Promise<void> {
  const slug = note.scope?.slug;
  if (!slug) return;
  if (await isPendingDelete(slug)) return;
  await ensureDirs();
  packGen += 1;
  await clearPendingDelete(slug);
  await writeJson(notePath(slug), note);
  const idx = await getIndex();
  if (!idx.includes(slug)) {
    idx.push(slug);
    await setIndex(idx);
  }
  cacheUpsert(note);
}

export async function saveAttachmentBytes(sha256: string, bytes: ArrayBuffer): Promise<string> {
  await ensureDirs();
  const path = `${attDir()}${sha256}`;
  const b64 = arrayBufferToBase64(bytes);
  await FileSystem.writeAsStringAsync(path, b64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return path;
}

export async function readAttachmentBytes(sha256: string): Promise<ArrayBuffer | null> {
  const path = `${attDir()}${sha256}`;
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) return null;
  const b64 = await FileSystem.readAsStringAsync(path, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return base64ToArrayBuffer(b64);
}

export async function attachmentLocalUri(sha256: string): Promise<string | null> {
  const path = `${attDir()}${sha256}`;
  const info = await FileSystem.getInfoAsync(path);
  return info.exists ? path : null;
}

export function emptyBlocks(): Block[] {
  return [{ id: newBlockId(), indent: 0, text: "" }];
}

export { displayScope };

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b || 0) << 8) | (c || 0);
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63];
    out += b === undefined ? "=" : chars[(n >> 6) & 63];
    out += c === undefined ? "=" : chars[n & 63];
  }
  return out;
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, "");
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const outLen = (clean.length * 3) / 4 - padding;
  const bytes = new Uint8Array(outLen);
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (chars.indexOf(clean[i]) << 18) |
      (chars.indexOf(clean[i + 1]) << 12) |
      (chars.indexOf(clean[i + 2]) << 6) |
      chars.indexOf(clean[i + 3]);
    if (p < outLen) bytes[p++] = (n >> 16) & 255;
    if (p < outLen) bytes[p++] = (n >> 8) & 255;
    if (p < outLen) bytes[p++] = n & 255;
  }
  return bytes.buffer;
}
