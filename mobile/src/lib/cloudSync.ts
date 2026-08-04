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
  /** join = used existing multiword door; claim = created a new one */
  mode: "join" | "claim" | "resume";
};

export type EnableCloudOpts = {
  /**
   * Existing multiword door phrase (e.g. quiet-river-lantern).
   * When set, opens that pack and syncs (typical for pull-from-remote).
   * When omitted, claims a new random door.
   */
  door?: string;
};

/** Normalize user-entered multiword phrase → door path segment. */
export function normalizeDoorPhrase(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Enable cloud and sync.
 * - With `opts.door`: join an existing multiword door (pull remote + push local).
 * - Without: claim a fresh door (or resume the previously saved door if re-enabling).
 */
export async function enableCloudAndSync(
  host = DEFAULT_HOST,
  opts: EnableCloudOpts = {}
): Promise<SyncResult> {
  const hostN = host.replace(/\/+$/, "");
  const meta = await Local.getMeta();
  let door = "";
  let mode: SyncResult["mode"] = "claim";

  const requested = opts.door ? normalizeDoorPhrase(opts.door) : "";
  if (requested) {
    // Join existing pack (or sync on known door) — verify before writing meta
    const probe = new KeyverseClient({ host: hostN, door: requested });
    try {
      await probe.protocol();
    } catch {
      throw new Error("That key didn’t work. Check it and try again.");
    }
    door = requested;
    mode =
      meta.cloud?.enabled && meta.cloud?.door === requested ? "resume" : "join";
  } else if (meta.cloud?.door) {
    // Re-enable or re-sync the previously saved door (do not claim a new one)
    door = meta.cloud.door;
    mode = "resume";
    const probe = new KeyverseClient({ host: hostN, door });
    try {
      await probe.protocol();
    } catch {
      // Door gone — fall through to claim only if user did not specify a phrase
      door = "";
      mode = "claim";
    }
  }

  if (!door) {
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
    if (!claimed) {
      throw new Error("Couldn’t turn on sync. Check your connection and try again.");
    }
    door = claimed;
    mode = "claim";
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

  // Pull cloud → local (union): fetch notes in parallel, bulk-write once
  const remote = await client.listNotes();
  const fullNotes: Note[] = (
    await Promise.all(
      remote.map(async (rn) => {
        const slug = rn.scope?.slug;
        if (!slug) return null;
        return client.getNote(slug).catch(() => rn);
      })
    )
  ).filter((n): n is Note => !!n);

  const pulled = await Local.bulkUpsertNotes(fullNotes);

  // Attachment blobs — parallel, skip ones already on device
  await Promise.all(
    fullNotes.flatMap((full) =>
      (full.attachments || []).map(async (a) => {
        if (a.kind !== "file" || !a.sha256) return;
        const existing = await Local.readAttachmentBytes(a.sha256);
        if (existing) return;
        try {
          const bytes = await client.getAttachmentBytes(a.sha256);
          await Local.saveAttachmentBytes(a.sha256, bytes);
          attN++;
        } catch {
          /* skip */
        }
      })
    )
  );

  await Local.setMeta({
    cloud: {
      enabled: true,
      host: hostN,
      door,
      last_sync_at: new Date().toISOString(),
    },
  });

  return { door, host: hostN, pushed, pulled, attachments: attN, mode };
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
  // Resume sync on the already-enabled door (do not claim a new one)
  return enableCloudAndSync(meta.cloud.host || DEFAULT_HOST, { door: meta.cloud.door });
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
