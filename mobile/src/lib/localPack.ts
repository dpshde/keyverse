/**
 * Local-first pack store. Notes live on device; cloud is optional mirror.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import type { Attachment, Block, Note, Scope } from "../api/types";
import { hydrateBlocks, newBlockId } from "../api/client";
import { resolveLocal, displayScope } from "./resolveLocal";

const META_KEY = "kv.local.meta.v1";
const NOTES_INDEX = "kv.local.notesIndex.v1";

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

function notesDir(): string {
  return `${FileSystem.documentDirectory}keyverse/pack/notes/`;
}

function attDir(): string {
  return `${FileSystem.documentDirectory}keyverse/pack/attachments/`;
}

async function ensureDirs() {
  await FileSystem.makeDirectoryAsync(notesDir(), { intermediates: true }).catch(() => {});
  await FileSystem.makeDirectoryAsync(attDir(), { intermediates: true }).catch(() => {});
}

async function readJson<T>(uri: string): Promise<T | null> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return null;
    const t = await FileSystem.readAsStringAsync(uri);
    return JSON.parse(t) as T;
  } catch {
    return null;
  }
}

async function writeJson(uri: string, obj: unknown) {
  await ensureDirs();
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(obj, null, 2));
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
  const raw = await AsyncStorage.getItem(NOTES_INDEX);
  return raw ? (JSON.parse(raw) as string[]) : [];
}

async function setIndex(slugs: string[]) {
  const uniq = [...new Set(slugs)].sort();
  await AsyncStorage.setItem(NOTES_INDEX, JSON.stringify(uniq));
}

function notePath(slug: string) {
  return `${notesDir()}${slug}.json`;
}

export async function listNotes(): Promise<Note[]> {
  await ensureDirs();
  const slugs = await getIndex();
  const notes: Note[] = [];
  for (const slug of slugs) {
    const n = await readJson<Note>(notePath(slug));
    if (n) notes.push(n);
  }
  notes.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
  return notes;
}

export async function getNote(slug: string): Promise<Note | null> {
  return readJson<Note>(notePath(slug));
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
  const existing = (await getNote(slug)) || null;
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
    await FileSystem.deleteAsync(notePath(slug), { idempotent: true }).catch(() => {});
    const idx = (await getIndex()).filter((s) => s !== slug);
    await setIndex(idx);
    return { deleted: true, slug };
  }

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

  await writeJson(notePath(slug), note);
  const idx = await getIndex();
  if (!idx.includes(slug)) {
    idx.push(slug);
    await setIndex(idx);
  }
  await setMeta({}); // touch updated_at
  return note;
}

export async function upsertNoteRecord(note: Note): Promise<void> {
  const slug = note.scope?.slug;
  if (!slug) return;
  await ensureDirs();
  await writeJson(notePath(slug), note);
  const idx = await getIndex();
  if (!idx.includes(slug)) {
    idx.push(slug);
    await setIndex(idx);
  }
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
