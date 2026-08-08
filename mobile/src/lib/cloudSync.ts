/**
 * Cloud mirror: multiword door on multipack host.
 *
 * Sync is pull-first, then push — with content stomp guards and optimistic
 * concurrency (`X-KV-Base-Updated-At`). See `syncMerge.ts` for the policy.
 */
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system/legacy";
import { ApiError, KeyverseClient } from "../api/client";
import type { Attachment, Note } from "../api/types";
import * as Local from "./localPack";
import { contentScore, planSync } from "./syncMerge";

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
  /** Conflicts where door rejected a push (base stamp mismatch) — those were pulled instead. */
  conflicts: number;
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
 * Serialize cloud syncs. Concurrent quietSync + manual sync + mid-edit mirror
 * races used to re-push notes that had already been deleted locally.
 */
let syncChain: Promise<unknown> = Promise.resolve();

function enqueueSync<T>(fn: () => Promise<T>): Promise<T> {
  const run = syncChain.then(fn, fn);
  syncChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * Live local note still eligible to push (not pending-delete / not removed mid-sync).
 * Snapshot from listNotes() alone is unsafe — deletes land while the loop runs.
 */
async function liveNoteForPush(slug: string): Promise<Note | null> {
  if (await Local.isPendingDelete(slug)) return null;
  const live = Local.peekNote(slug) ?? (await Local.getNote(slug));
  if (!live) return null;
  if (await Local.isPendingDelete(slug)) return null;
  return live;
}

/** Apply door note into local pack (pull / post-PUT echo). */
async function applyRemoteNote(note: Note): Promise<void> {
  await Local.bulkUpsertNotes([note]);
}

/**
 * Enable cloud and sync.
 * - With `opts.door`: join an existing multiword door (pull remote + push local).
 * - Without: claim a fresh door (or resume the previously saved door if re-enabling).
 *
 * Order: flush deletes → plan → **pull first** → push with base stamp → flush deletes.
 */
export async function enableCloudAndSync(
  host = DEFAULT_HOST,
  opts: EnableCloudOpts = {}
): Promise<SyncResult> {
  return enqueueSync(() => enableCloudAndSyncUnlocked(host, opts));
}

async function enableCloudAndSyncUnlocked(
  host = DEFAULT_HOST,
  opts: EnableCloudOpts = {}
): Promise<SyncResult> {
  const hostN = host.replace(/\/+$/, "");
  const meta = await Local.getMeta();
  let door = "";
  let mode: SyncResult["mode"] = "claim";

  const requested = opts.door ? normalizeDoorPhrase(opts.door) : "";
  if (requested) {
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
    door = meta.cloud.door;
    mode = "resume";
    const probe = new KeyverseClient({ host: hostN, door });
    try {
      await probe.protocol();
    } catch {
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
  await client.protocol();

  // Tombstones first so a pull cannot resurrect deleted notes
  await flushPendingCloudDeletes(client);

  const localNotes = await Local.listNotes();
  const localBySlug = new Map<string, Note>();
  for (const n of localNotes) {
    const s = n.scope?.slug;
    if (s) localBySlug.set(s, n);
  }

  const remoteList = await client.listNotes();
  const remoteBySlug = new Map<string, Note>();
  for (const n of remoteList) {
    const s = n.scope?.slug;
    if (s) remoteBySlug.set(s, n);
  }

  const pendingList = await Local.listPendingDeletes();
  const pendingDeletes = new Set(pendingList);

  const plan = planSync({ localBySlug, remoteBySlug, pendingDeletes });

  let pulled = 0;
  let pushed = 0;
  let conflicts = 0;
  let attN = 0;

  // —— PULL FIRST (remote-newer / remote-richer / anti-stomp) ——
  const pullNotes: Note[] = (
    await Promise.all(
      plan.pull.map(async (slug) => {
        if (await Local.isPendingDelete(slug)) return null;
        const listed = remoteBySlug.get(slug);
        if (listed) return listed;
        return client.getNote(slug).catch(() => null);
      })
    )
  ).filter((n): n is Note => !!n);

  if (pullNotes.length) {
    pulled = await Local.bulkUpsertNotes(pullNotes);
    await Promise.all(
      pullNotes.flatMap((full) =>
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
  }

  // —— PUSH (local-newer / local-only), with base stamp from pre-sync remote ——
  for (const slug of plan.push) {
    const note = await liveNoteForPush(slug);
    if (!note) continue;
    // Re-check stomp against the *listed* remote (pre-pull snapshot is fine for base;
    // after pull-first, destructive cases should already be on the pull list).
    const remoteSnap = remoteBySlug.get(slug);
    if (remoteSnap && contentScore(note).empty && !contentScore(remoteSnap).empty) {
      // Never empty-stomp; pull remote instead
      await applyRemoteNote(remoteSnap);
      pulled++;
      continue;
    }

    const baseUpdatedAt = remoteSnap?.updated_at;

    try {
      if (note.encrypted && note.cipher) {
        if (await Local.isPendingDelete(slug)) continue;
        const res = await client.putNote(
          slug,
          { encrypted: true, cipher: note.cipher },
          { baseUpdatedAt }
        );
        if (!("deleted" in res) || !res.deleted) {
          // Echo server stamp so next LWW is coherent
          if ("updated_at" in res && res.updated_at) {
            await applyRemoteNote(res as Note);
          }
        }
        pushed++;
        continue;
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
      if (await Local.isPendingDelete(slug)) continue;
      if (!(Local.peekNote(slug) ?? (await Local.getNote(slug)))) continue;

      const res = await client.putNote(
        slug,
        { blocks: note.blocks, attachments: atts },
        { baseUpdatedAt }
      );
      if ("deleted" in res && res.deleted) {
        /* ok */
      } else if ("updated_at" in res) {
        await applyRemoteNote(res as Note);
      }
      pushed++;
    } catch (e) {
      // Concurrent edit on door — absorb remote, never retry-push over it this pass
      if (e instanceof ApiError && e.status === 409) {
        conflicts++;
        const body = e.body as { current?: Note } | null;
        const current =
          body && typeof body === "object" && body.current
            ? body.current
            : await client.getNote(slug).catch(() => null);
        if (current) {
          await applyRemoteNote(current);
          pulled++;
        }
        continue;
      }
      throw e;
    }
  }

  // Deletes that landed during push
  await flushPendingCloudDeletes(client);

  await Local.setMeta({
    cloud: {
      enabled: true,
      host: hostN,
      door,
      last_sync_at: new Date().toISOString(),
    },
  });

  return { door, host: hostN, pushed, pulled, attachments: attN, conflicts, mode };
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
  return enableCloudAndSync(meta.cloud.host || DEFAULT_HOST, { door: meta.cloud.door });
}

async function cloudDeleteNote(client: KeyverseClient, slug: string): Promise<void> {
  await client.putNote(slug, { blocks: [], attachments: [] });
  await Local.clearPendingDelete(slug);
}

async function flushPendingCloudDeletes(client: KeyverseClient): Promise<void> {
  const pending = await Local.listPendingDeletes();
  for (const slug of pending) {
    try {
      await cloudDeleteNote(client, slug);
    } catch {
      /* stay pending — next sync retries */
    }
  }
}

/**
 * After local note save/delete, optionally mirror to cloud immediately.
 * Serialized on the same chain as full sync. Never empty-stomps richer remote
 * content; never overwrites a newer remote stamp (GET + base header).
 */
export async function mirrorNoteIfCloud(slug: string): Promise<void> {
  return enqueueSync(() => mirrorNoteIfCloudUnlocked(slug));
}

async function mirrorNoteIfCloudUnlocked(slug: string): Promise<void> {
  const meta = await Local.getMeta();
  if (!meta.cloud?.enabled || !meta.cloud.door) {
    if (!(await Local.getNote(slug))) {
      await Local.clearPendingDelete(slug);
    }
    return;
  }
  const client = new KeyverseClient({ host: meta.cloud.host, door: meta.cloud.door });

  // Explicit local delete
  if (await Local.isPendingDelete(slug) || !(await Local.getNote(slug))) {
    try {
      await cloudDeleteNote(client, slug);
    } catch {
      /* pending kept */
    }
    return;
  }

  const note = await Local.getNote(slug);
  if (!note) return;

  // Fresh remote for LWW + stomp guard
  let remote: Note | null = null;
  try {
    remote = await client.getNote(slug);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      remote = null;
    } else {
      // Network error: leave for quietSync
      return;
    }
  }

  if (remote) {
    const L = contentScore(note);
    const R = contentScore(remote);
    // Remote is newer → absorb, do not stomp
    if ((remote.updated_at || "") > (note.updated_at || "")) {
      await applyRemoteNote(remote);
      await Local.clearPendingDelete(slug);
      return;
    }
    // Empty local over contentful remote → absorb remote (not a delete path)
    if (L.empty && !R.empty) {
      await applyRemoteNote(remote);
      return;
    }
  }

  const baseUpdatedAt = remote?.updated_at;

  try {
    if (note.encrypted && note.cipher) {
      const res = await client.putNote(
        slug,
        { encrypted: true, cipher: note.cipher },
        { baseUpdatedAt, allowShrink: true }
      );
      if (!("deleted" in res) && "updated_at" in res) {
        await applyRemoteNote(res as Note);
      }
      await Local.clearPendingDelete(slug);
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

    // User-authored save path: allow intentional shrink; still send base when known.
    const res = await client.putNote(
      slug,
      { blocks: note.blocks, attachments: atts },
      { baseUpdatedAt, allowShrink: true }
    );
    if ("deleted" in res && res.deleted) {
      /* cleared */
    } else if ("updated_at" in res) {
      await applyRemoteNote(res as Note);
    }
    await Local.clearPendingDelete(slug);
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      const body = e.body as { current?: Note; error?: string } | null;
      const current =
        body && typeof body === "object" && body.current
          ? body.current
          : await client.getNote(slug).catch(() => null);
      if (current) await applyRemoteNote(current);
      return;
    }
    // Transient — quietSync retries
  }
}
