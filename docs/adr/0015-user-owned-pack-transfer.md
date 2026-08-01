# 0015. User-owned pack transfer (export / import)

## Status

Accepted

## Context

User-owned data is critical. Backup-by-operator-volume is necessary but not
sufficient: a person must leave with their notes without the host vendor, and
return (or move hosts) without proprietary lock-in.

Copying a folder works for operators. End users need one-click export/import
and a defined zip contents list that matches the protocol pack.

## Decision

1. **Export** produces a zip of user-owned paths only:
   `protocol.json`, `door`, `notes/**`, `attachments/**`.
2. **Never export** disposable scripture cache (`text/`, `_cache/`).
3. **Import** accepts that zip into a pack directory with:
   - `mode=merge` (default): write/overwrite paths present in the zip
   - `mode=replace`: clear `notes/` and `attachments/` first
4. After import, run **pack conformance**; fail closed on protocol errors for
   API responses (`422`).
5. Surfaces: home UI, `GET/POST /api/pack/*`, `mix keyverse.export|import`.
6. Transfer is a **door profile**, not a change to note addressing or record shape.

## Consequences

- **Easier:** portable backups; host migration; proves “pack is the product.”
- **Harder:** large attachments make large zips; merge is last-write-wins per
  file (not CRDT); sealed notes remain sealed (passphrase separate).
- **Implication:** product copy and `/api/protocol` advertise ownership/export.
