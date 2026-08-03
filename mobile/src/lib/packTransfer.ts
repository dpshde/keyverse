/**
 * Pack zip import/export — same user-data shape as server PackTransfer:
 * protocol.json, door (optional), notes/**, attachments/**
 * Never includes scripture text packs.
 */
import * as FileSystem from "expo-file-system/legacy";
import { strToU8, strFromU8, zipSync, unzipSync } from "fflate";
import type { Note } from "../api/types";
import * as Local from "./localPack";

const PROTOCOL = {
  protocol: "keyverse-pack",
  version: "0.2",
  source: "keyverse-mobile",
};

function notesDir(): string {
  return `${FileSystem.documentDirectory}keyverse/pack/notes/`;
}
function attDir(): string {
  return `${FileSystem.documentDirectory}keyverse/pack/attachments/`;
}

function b64ToBytes(b64: string): Uint8Array {
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
  return bytes;
}

function bytesToB64(bytes: Uint8Array): string {
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

export type ExportResult = {
  path: string;
  filename: string;
  notes: number;
  attachments: number;
  bytes: number;
};

export type ImportResult = {
  mode: "merge" | "replace";
  notes: number;
  attachments: number;
  files: number;
};

/**
 * Build a portable pack zip from the on-device local pack.
 */
export async function exportLocalPackZip(opts?: {
  door?: string;
}): Promise<ExportResult> {
  const notes = await Local.listNotes();
  const files: Record<string, Uint8Array> = {};

  files["protocol.json"] = strToU8(
    JSON.stringify(
      {
        ...PROTOCOL,
        exported_at: new Date().toISOString(),
        notes: notes.length,
      },
      null,
      2
    )
  );

  if (opts?.door) {
    files["door"] = strToU8(opts.door + "\n");
  }

  let attCount = 0;
  for (const note of notes) {
    const slug = note.scope?.slug;
    if (!slug) continue;
    files[`notes/${slug}.json`] = strToU8(JSON.stringify(note, null, 2));
    for (const a of note.attachments || []) {
      if (a.kind === "file" && a.sha256) {
        const path = `${attDir()}${a.sha256}`;
        const info = await FileSystem.getInfoAsync(path);
        if (info.exists) {
          const b64 = await FileSystem.readAsStringAsync(path, {
            encoding: FileSystem.EncodingType.Base64,
          });
          files[`attachments/${a.sha256}`] = b64ToBytes(b64);
          attCount++;
        }
      }
    }
  }

  // also include orphan attachment blobs still on disk
  try {
    const listed = await FileSystem.readDirectoryAsync(attDir());
    for (const name of listed) {
      const key = `attachments/${name}`;
      if (files[key]) continue;
      const b64 = await FileSystem.readAsStringAsync(`${attDir()}${name}`, {
        encoding: FileSystem.EncodingType.Base64,
      });
      files[key] = b64ToBytes(b64);
      attCount++;
    }
  } catch {
    /* no att dir */
  }

  if (Object.keys(files).length <= 1) {
    // still allow empty-ish export with protocol only + empty notes is ok if user wants backup
  }

  const zipped = zipSync(files, { level: 6 });
  const filename = `keyverse-pack-${new Date().toISOString().slice(0, 10)}.zip`;
  const path = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(path, bytesToB64(zipped), {
    encoding: FileSystem.EncodingType.Base64,
  });

  return {
    path,
    filename,
    notes: notes.length,
    attachments: attCount,
    bytes: zipped.byteLength,
  };
}

/**
 * Import a protocol pack zip into the local device pack.
 * mode=merge overwrites notes present in zip; replace clears local notes/attachments first.
 */
export async function importLocalPackZip(
  zipBytes: ArrayBuffer | Uint8Array,
  mode: "merge" | "replace" = "merge"
): Promise<ImportResult> {
  const raw = zipBytes instanceof Uint8Array ? zipBytes : new Uint8Array(zipBytes);
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(raw);
  } catch (e) {
    throw new Error(`invalid zip: ${e}`);
  }

  const entries = Object.entries(unzipped)
    .map(([name, data]) => [normalizeRel(name), data] as const)
    .filter(([rel]) => rel != null) as [string, Uint8Array][];

  if (!entries.length) throw new Error("zip contained no safe pack paths");

  if (mode === "replace") {
    await clearLocalNotesAndAttachments();
    Local.invalidateNotesCache();
  }

  let noteCount = 0;
  let attCount = 0;

  for (const [rel, data] of entries) {
    if (rel === "protocol.json" || rel === "door") {
      // optional metadata — keep door for display only
      if (rel === "door") {
        const door = strFromU8(data).trim();
        if (door) {
          const meta = await Local.getMeta();
          if (meta.cloud?.enabled) {
            /* don't overwrite live cloud door from import */
          } else {
            await Local.setMeta({
              cloud: {
                enabled: false,
                host: meta.cloud?.host || "https://keyverse-production.up.railway.app",
                door,
              },
            });
          }
        }
      }
      continue;
    }

    if (rel.startsWith("notes/") && rel.endsWith(".json")) {
      const text = strFromU8(data);
      let note: Note;
      try {
        note = JSON.parse(text) as Note;
      } catch {
        continue;
      }
      const slug =
        note.scope?.slug ||
        rel.slice("notes/".length, -".json".length);
      if (!slug) continue;
      if (!note.scope) {
        note.scope = { kind: "verse", osis: slug.toUpperCase(), slug };
      }
      if (!note.id) note.id = `n_${slug}`;
      await Local.upsertNoteRecord(note);
      noteCount++;
      continue;
    }

    if (rel.startsWith("attachments/")) {
      const sha = rel.slice("attachments/".length);
      if (!/^[a-f0-9]{64}$/i.test(sha)) continue;
      await Local.saveAttachmentBytes(
        sha,
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
      );
      attCount++;
    }
  }

  // Ensure list is coherent after bulk disk writes
  Local.invalidateNotesCache();
  return { mode, notes: noteCount, attachments: attCount, files: entries.length };
}

async function clearLocalNotesAndAttachments() {
  try {
    const notes = await FileSystem.readDirectoryAsync(notesDir());
    for (const f of notes) {
      await FileSystem.deleteAsync(`${notesDir()}${f}`, { idempotent: true });
    }
  } catch {
    /* */
  }
  try {
    const atts = await FileSystem.readDirectoryAsync(attDir());
    for (const f of atts) {
      await FileSystem.deleteAsync(`${attDir()}${f}`, { idempotent: true });
    }
  } catch {
    /* */
  }
  await Local.setMeta({}); // touch
  // reset index
  const { default: AsyncStorage } = await import("@react-native-async-storage/async-storage");
  await AsyncStorage.setItem("kv.local.notesIndex.v1", "[]");
}

function normalizeRel(name: string): string | null {
  let rel = name.replace(/\\/g, "/").replace(/^\/+/, "");
  // strip single top-level folder prefix if zip was nested
  if (rel.includes("/") && !rel.startsWith("notes/") && !rel.startsWith("attachments/")) {
    const parts = rel.split("/");
    if (parts[0] && !["notes", "attachments", "protocol.json", "door"].includes(parts[0])) {
      // e.g. pack/notes/x.json
      if (parts[1] === "notes" || parts[1] === "attachments" || parts[1] === "protocol.json" || parts[1] === "door") {
        rel = parts.slice(1).join("/");
      }
    }
  }
  if (rel.includes("..")) return null;
  if (rel === "protocol.json" || rel === "door") return rel;
  if (rel.startsWith("notes/") && rel.endsWith(".json")) return rel;
  if (rel.startsWith("attachments/") && !rel.endsWith("/")) return rel;
  return null;
}

/**
 * Import from cloud host export endpoint when cloud is enabled.
 */
export async function importFromCloudZip(
  zipBytes: ArrayBuffer,
  mode: "merge" | "replace" = "merge"
): Promise<ImportResult> {
  return importLocalPackZip(zipBytes, mode);
}
