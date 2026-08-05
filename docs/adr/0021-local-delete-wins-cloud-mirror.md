# 0021. Local delete wins over cloud mirror

## Status

Accepted

## Context

Mobile is local-first (ADR 0018). Cloud is an optional multiword door that
**mirrors** the on-device pack (`mobile/src/lib/cloudSync.ts`). Protocol delete is
simple: empty note body + no attachments → unlink the note file (PROTOCOL §3;
cowyo-style empty write).

With quiet full-pack sync (app launch, foreground, Settings re-enable), three
races produced **zombie notes** — notes the user deleted that kept coming back:

1. **Stale push** — sync took a one-shot `listNotes()` snapshot, then pushed every
   entry. A delete (and door empty-PUT) that landed mid-loop was still
   re-uploaded from the stale snapshot.
2. **Concurrent quietSync** — launch + resume (and manual sync) could run
   overlapping full syncs without a queue.
3. **Editor save-after-delete** — reader tray / full note ignored delete events
   while dirty, then autosave or unmount flush rewrote content and cleared the
   pending-delete tombstone.
4. **Stale list snapshot** — cold start could paint `_list_cache.v1.json` that
   still listed a deleted slug; sync then pushed it.

Example: `rev.12.2` on door `stay-bird-base-rich` survived repeated deletes until
the door was empty-PUT cleared and the client races were fixed.

## Decision

1. **Local delete is authoritative until the door is confirmed empty for that
   slug.** `deleteNote` always marks a **pending cloud delete** tombstone
   (`kv.local.pendingDeletes.v1` + in-memory set).
2. **Empty PUT clears the door** (`blocks: []`, `attachments: []` → host
   `{deleted: true}`). Immediate path: `mirrorNoteIfCloud`. Batch path:
   `flushPendingCloudDeletes` at the start **and end** of a full sync (after the
   push loop, before pull).
3. **Push must re-verify each slug** — skip if pending-delete or the note is no
   longer present locally; never push solely from the initial list snapshot.
4. **Pull must not resurrect pending slugs** — `bulkUpsertNotes` and remote
   fetch skip `isPendingDelete(slug)`.
5. **Serialize full syncs** (promise chain) so quietSync cannot interleave.
6. **Editors honor deletes even when dirty** — cancel timers, bump save gen,
   clear blocks, set a deleted guard so unmount flush cannot rewrite the note.
   A later intentional keystroke is a recreate (clears the guard / tombstone via
   normal `putNote`).
7. **List snapshot cannot outlive a delete** — `cacheRemove` flushes or drops
   `_list_cache`; cold `listNotes` strips pending-delete slugs from any snapshot.

These are **client mirror invariants**, not a protocol change. The pack on disk
and the door empty-PUT semantics stay as PROTOCOL / ADR 0001.

## Consequences

### Positive

- Home swipe-delete and empty-tray delete stay gone across quietSync and app
  restarts (single device + this mirror).
- Pending tombstones make “delete in flight” observable and retriable.
- Intentional recreate after delete still works (type again → `putNote` clears
  pending and writes).

### Negative / limits

- **Multi-device:** another client that still holds the note can re-push after
  this device’s delete. There is no server-side tombstone beyond “file absent.”
  True multi-writer delete semantics remain deferred (ADR 0008).
- Pending set is device-local AsyncStorage; wiping app data drops tombstones
  (door state then wins on next pull).
- Full sync is serialized — concurrent “Sync now” waits on the previous run.

## Implementation map

| Concern | Where |
|---------|--------|
| Pending deletes, `deleteNote`, list snapshot | `mobile/src/lib/localPack.ts` |
| Sync queue, live push check, double flush | `mobile/src/lib/cloudSync.ts` |
| Quiet sync triggers | `mobile/src/context/SessionContext.tsx` |
| Tray delete guard | `mobile/src/components/InlineNoteEditor.tsx` |
| Full note delete guard | `mobile/app/note/[slug].tsx` |
| Home swipe + mirror | `mobile/app/home.tsx` |

## Symptom checklist (if zombies return)

1. Door still has note? `GET /{door}/api/note/{slug}` → 200 means something
   re-pushed (this device or another). Empty PUT should 200 `{deleted:true}`
   then GET 404.
2. Device pending set stuck? Failed mirror leaves pending — next quietSync
   should retry flush. If pending cleared but door still has note, a push raced
   after clear (should be fixed by live push check + post-push flush).
3. Editor open on that slug while deleting elsewhere? Guard must cancel dirty
   save; if not, check `deletedRef` / subscribe path.

## References

- [PROTOCOL.md](../../PROTOCOL.md) — empty write deletes the note file
- [ADR 0001](./0001-pack-on-disk-is-source-of-truth.md) — pack on disk
- [ADR 0018](./0018-react-native-mobile-client.md) — mobile client
- [mobile/README.md](../../mobile/README.md) — product client notes
- [AGENTS.md](../../AGENTS.md) — architecture touchpoints
