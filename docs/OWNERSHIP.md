# User-owned data (keyverse)

**You own the pack.** The multipack host is a door, not a landlord. This doc is
the product contract for ownership, export, import, and backup.

Priority: **frictionlessness > portability > permanence** — ownership is how
portability shows up for humans.

## What you own

| Path | Content |
|------|---------|
| `protocol.json` | Pack format version |
| `door` | Multiword key (optional file; also directory name) |
| `notes/*.json` | Your notes (plaintext or sealed envelopes) |
| `attachments/<sha256>` | File bytes you attached |
| `ops/<slug>/<sha256>.json` | Append-only edit log (merge history, PROTOCOL §10) |

**Not yours / disposable:** scripture text cache (`text/`, host `_cache/`). Never
required for a complete pack.

## Export

### Browser
Open your notes → **Export** on the home page (zip download).

### HTTP
```http
GET /{door}/api/pack/export
→ application/zip
```

### CLI
```sh
mix keyverse.export /path/to/pack ./my-notes.zip
# or copy the folder:
cp -a /var/lib/keyverse/packs/your-four-word-key ~/Backup/keyverse-pack
```

Export includes only user paths above. No account, no proprietary blob format.

## Import

### Browser
**Import** on the home page (accepts a pack `.zip`). Merges by default.
Keyverse export zips work as-is; a zip of a pack folder (e.g. Finder
**Compress**) is also accepted — the single wrapper directory is stripped.

### HTTP
```http
POST /{door}/api/pack/import?mode=merge
Content-Type: multipart/form-data
# field name: pack  (the zip file)

# or raw body:
POST /{door}/api/pack/import?mode=replace
Content-Type: application/zip
```

Import runs **pack conformance** after write. Invalid packs return `422` with
error codes (server still may have written files — fix or re-export).

### CLI
```sh
mix keyverse.import ./my-notes.zip /path/to/dest-pack
mix keyverse.import ./my-notes.zip /path/to/dest-pack --replace
```

## Manifest
```http
GET /{door}/api/pack
```
Note counts, attachment totals, protocol version, export include/exclude lists.

## Offline / dead server
1. Hold the pack directory or zip.
2. Read notes with any JSON tool.
3. Point another keyverse host at the folder (`PACK_DIR=…`) or import the zip.
4. **Browser read-only mount (Chromium):** open `/local` → **Open local pack…**
   (File System Access). Same pack layout; no upload. Edit still needs a door or
   future read-write mount.
5. Sealed notes need your **passphrase** (not the multiword door) — see PROTOCOL §3.1.

## Single-writer (v0.2)
One writer per pack at a time is assumed. Concurrent multi-device merge is
deferred (ADR 0008). Practical rule: export before switching devices if both
might write; prefer one active door session.

## Operator backups
Host operators should still volume-backup `PACK_DIR`. That does not replace
**user export** — users must be able to leave with a zip without operator help.

## Related
- Protocol core: [PROTOCOL.md](../PROTOCOL.md)
- Conformance: `mix keyverse.conformance`, [protocol/](../protocol/)
- HTTP matrix: [API.md](./API.md)
- ADR 0001 (pack SoT), ADR 0015 (transfer)
