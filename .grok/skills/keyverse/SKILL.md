---
name: keyverse
description: >
  Implement or integrate keyverse packs and the HTTP door: OSIS-addressed notes,
  flat outline blocks, CAS attachments, multiword door access, client-side encryption.
  Use when building a keyverse/versepack client, importing pack/, calling /api/note,
  /api/protocol, /api/resolve, or when the user mentions keyverse, scripture note pack,
  or multiword door. Slash: /keyverse.
---

# keyverse client skill

Pack is source of truth. HTTP door is optional. Version `0.1-demo`.

## Read first

| Need | File |
|------|------|
| Normative rules | `PROTOCOL.md` |
| HTTP status matrix | `docs/API.md` |
| Machine index | `llms.txt` |
| Schemas | `schemas/*.schema.json` |

Do not re-derive protocol from `server.mjs` unless debugging a mismatch.

## Choose integration path

1. **Same machine / backup / import** → read/write one pack dir (`packs/{key}/` or a lone pack folder).
2. **Remote or second app** → HTTP under `/{door}/api/…` (door = pack key).
3. Discover with `GET {BASE}/api/protocol` before other calls.
4. **New pack on a multipack host** → `POST /setup` (form) or create `packs/{key}/` on disk.

```sh
DOOR=quiet-river-lantern   # multiword pack key
BASE="http://localhost:4180/$DOOR"
# disk: $PACK_DIR/$DOOR/  (default PACK_DIR=./packs)
```

## Addressing

- Human → canonical: `GET /api/resolve?q=John+3:16` or `grab-bcv`.
- Slug = OSIS lowercased (`jhn.3.16`). Filenames and URL segments use slug.
- One address → one note file. Never merge notes because one scope contains another.

## Minimum HTTP client

```text
GET  /api/protocol
GET  /api/notes
GET  /api/note/<slug>
PUT  /api/note/<slug>   Content-Type: application/json
POST /api/note/<slug>/attachments
GET  /api/attachments/<sha256>
```

### Write notes

```sh
curl -X PUT "$BASE/api/note/jhn.3.16" \
  -H 'content-type: application/json' \
  -d '{"blocks":[{"id":"b1","indent":0,"text":"…"}]}'
```

- Preserve block `id`s you did not delete.
- Omit `attachments` to keep existing files/URLs.
- Empty blocks + no attachments → `{deleted:true}` (address cleared).
- Text interchange: 2 spaces = one indent; loses `collapsed`.

### Encrypted notes

- Passphrase stays in the client. Server stores only `cipher`.
- `GET ?raw` or text PUT on sealed note → **409**.
- POST file attach on sealed note → `{encrypted:true, attachment:{…}}`; fold into next cipher PUT.
- Cipher: AES-GCM + PBKDF2-SHA-256, 210000 iter; see `schemas/cipher.schema.json`.

### Attachments

- URL: `POST` JSON `{kind:"url",url:"https://…",title?}`.
- File: raw body + `Content-Type` + optional `X-Filename`.
- Bytes live at `attachments/<sha256>`; note holds metadata only.

## Pack filesystem client

1. Read `protocol.json` in the pack dir.
2. Enumerate `notes/*.json`; validate optionally with `schemas/note.schema.json`.
3. For each `attachments[]` with `kind:file`, load `attachments/<sha256>`.
4. Ignore unknown keys. Hydrate legacy `body` → blocks.
5. Write pretty-printed UTF-8 JSON + trailing newline (reference style).

## CORS / door

- Door path **is** the pack key (and the secret). No accounts. One key → one pack.
- API CORS defaults to `*`. `CORS_ORIGIN=off` disables.
- Browser SPAs on another origin need door URL + CORS (default on).

## PWA

- Manifest: `GET /manifest.webmanifest` or `/{door}/manifest.webmanifest` (start_url = pack home).
- Service worker: `GET /sw.js` (root scope `/`) — register from any page.
- Icons: `/icons/icon-192.png`, `icon-512.png`, maskable variants, `apple-touch-icon.png`.
- Offline: shell + cached GET navigations/API; writes need network.
- Install needs HTTPS or localhost.

## Must not

- Multi-writer merge (undefined).
- Treat `text/` as user data.
- Send passphrase to the server.
- Copy note bodies between addresses for “folders” (project containment in the UI only).

## Verify after changes

```sh
pnpm check
# with server running:
curl -s "$BASE/api/protocol" | head
curl -s "$BASE/api/resolve?q=Rom+8:28"
```
