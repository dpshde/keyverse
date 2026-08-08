# ADR 0022 — Sync anti-stomp (pull-first + base stamp)

## Status

Accepted — 2026-08-08

## Context

Mobile quietSync previously **pushed every local note, then pulled**. Local
copies that were older or thinner overwrote richer web/op-log state (lost nested
outline lines, wiki links, multi-block notes). Recovery required replaying live
`ops/**` history.

LWW by `updated_at` alone is not enough when a thin local re-save gets a new
clock stamp, or when list→push races a concurrent web edit.

## Decision

1. **Merge policy** (`mobile/src/lib/syncMerge.ts`): per-slug plan of push / pull /
   delete / skip. Never bulk-push thinner over richer remote (always pull).
2. **Pull first, then push** on full sync.
3. **Optimistic concurrency**: `X-KV-Base-Updated-At` → **409 conflict** if door is newer.
4. **Server shrink guard** (`Keyverse.NoteGuard`): refuse severe content shrinks
   unless `X-KV-Allow-Shrink: 1` or explicit empty delete. Old mobile quietSync
   that still push-all cannot wipe Hebrews notes even without base stamps.
5. **Live mirror** / web outliner send `X-KV-Allow-Shrink: 1` (user-authored).

## Consequences

- Deploy door first for protection; then ship mobile for cleaner merge.
- Intentional multi-line deletes from editors still work (allow-shrink).
- Bulk sync never sends allow-shrink.

## References

- PROTOCOL.md addressing + notes
- docs/API.md note PUT matrix (add header)
