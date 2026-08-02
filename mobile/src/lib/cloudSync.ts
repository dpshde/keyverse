/**
 * Cloud mirror: multiword door on multipack host.
 * Enabling cloud claims a door and doubles local notes onto the server (and pulls remote).
 */
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system/legacy";
import { KeyverseClient } from "../api/client";
import type { Attachment, Note } from "../api/types";
import * as Local from "./localPack";

const DEFAULT_HOST = "https://keyverse-production.up.railway.app";

async function loadWordList(): Promise<string[]> {
  try {
    const asset = Asset.fromModule(require("../../assets/words-door.txt"));
    await asset.downloadAsync();
    const uri = asset.localUri || asset.uri;
    const text = await FileSystem.readAsStringAsync(uri!);
    return text
      .split(/\r?\n/)
      .map((w) => w.trim().toLowerCase())
      .filter((w) => w.length >= 3);
  } catch {
    return ["quiet", "river", "lantern", "stone", "amber", "cedar", "frost", "meadow"];
  }
}

function pickWords(words: string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(words[Math.floor(Math.random() * words.length)]);
  }
  return out;
}

export async function generateDoorPhrase(count = 4): Promise<string> {
  const words = await loadWordList();
  return pickWords(words, count).join("-");
}

export type SyncResult = {
  door: string;
  host: string;
  pushed: number;
  pulled: number;
  attachments: number;
};

/**
 * Enable cloud: claim multiword door, push all local notes (+ file bytes), pull remote.
 * Local remains source of truth that is now mirrored.
 */
export async function enableCloudAndSync(host = DEFAULT_HOST): Promise<SyncResult> {
  const hostN = host.replace(/\/+$/, "");
  const meta = await Local.getMeta();
  let door = meta.cloud?.door;
  if (!door || !meta.cloud?.enabled) {
    // claim fresh door
    let claimed = "";
    for (let attempt = 0; attempt < 6; attempt++) {
      const phrase = await generateDoorPhrase(4);
      try {
        const c = new KeyverseClient({ host: hostN, door: "" });
        claimed = await c.setupClaim(phrase);
        break;
      } catch {
        /* try another phrase */
      }
    }
    if (!claimed) throw new Error("could not claim multiword door");
    door = claimed;
  }

  const client = new KeyverseClient({ host: hostN, door });
  await client.protocol(); // verify

  // Push local → cloud
  const localNotes = await Local.listNotes();
  let pushed = 0;
  let attN = 0;
  for (const note of localNotes) {
    const slug = note.scope?.slug;
    if (!slug) continue;
    if (note.encrypted && note.cipher) {
      await client.putNote(slug, { encrypted: true, cipher: note.cipher });
      pushed++;
      continue;
    }
    // files first so server CAS has blobs before note meta references them
    const atts = (note.attachments || []) as Attachment[];
    for (const a of atts) {
      if (a.kind === "file" && a.sha256) {
        const bytes = await Local.readAttachmentBytes(a.sha256);
        if (bytes) {
          try {
            await client.addFileAttachment(slug, bytes, a.name || "file", a.mime || "application/octet-stream");
            attN++;
          } catch {
            /* may already exist */
          }
        }
      } else if (a.kind === "url") {
        try {
          await client.addUrlAttachment(slug, a.url, a.title);
          attN++;
        } catch {
          /* ignore */
        }
      }
    }
    await client.putNote(slug, {
      blocks: note.blocks,
      attachments: atts,
    });
    pushed++;
  }

  // Pull cloud → local (union)
  let pulled = 0;
  const remote = await client.listNotes();
  for (const rn of remote) {
    const slug = rn.scope?.slug;
    if (!slug) continue;
    const full = await client.getNote(slug).catch(() => rn);
    await Local.upsertNoteRecord(full);
    // pull file bytes
    for (const a of full.attachments || []) {
      if (a.kind === "file" && a.sha256) {
        const existing = await Local.readAttachmentBytes(a.sha256);
        if (!existing) {
          try {
            const bytes = await client.getAttachmentBytes(a.sha256);
            await Local.saveAttachmentBytes(a.sha256, bytes);
            attN++;
          } catch {
            /* skip */
          }
        }
      }
    }
    pulled++;
  }

  await Local.setMeta({
    cloud: {
      enabled: true,
      host: hostN,
      door,
      last_sync_at: new Date().toISOString(),
    },
  });

  return { door, host: hostN, pushed, pulled, attachments: attN };
}

export async function disableCloudKeepLocal(): Promise<void> {
  const meta = await Local.getMeta();
  await Local.setMeta({
    cloud: meta.cloud
      ? { ...meta.cloud, enabled: false }
      : { enabled: false, host: DEFAULT_HOST, door: "" },
  });
}

export async function syncNow(): Promise<SyncResult> {
  const meta = await Local.getMeta();
  if (!meta.cloud?.enabled || !meta.cloud.door) {
    throw new Error("cloud not enabled");
  }
  return enableCloudAndSync(meta.cloud.host || DEFAULT_HOST);
}

/**
 * After local note save, optionally mirror to cloud immediately.
 */
export async function mirrorNoteIfCloud(slug: string): Promise<void> {
  const meta = await Local.getMeta();
  if (!meta.cloud?.enabled || !meta.cloud.door) return;
  const note = await Local.getNote(slug);
  if (!note) return;
  const client = new KeyverseClient({ host: meta.cloud.host, door: meta.cloud.door });
  if (note.encrypted && note.cipher) {
    await client.putNote(slug, { encrypted: true, cipher: note.cipher });
    return;
  }
  const atts = (note.attachments || []) as Attachment[];
  for (const a of atts) {
    if (a.kind === "file" && a.sha256) {
      const bytes = await Local.readAttachmentBytes(a.sha256);
      if (bytes) {
        try {
          await client.addFileAttachment(
            slug,
            bytes,
            a.name || "file",
            a.mime || "application/octet-stream"
          );
        } catch {
          /* ok */
        }
      }
    }
  }
  await client.putNote(slug, { blocks: note.blocks, attachments: atts });
}
