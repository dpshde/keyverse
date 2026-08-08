# keyverse HTTP door API

Reference door contract for the Elixir multipack host (**protocol `0.2`**).  
Pack-on-disk remains the durable interop surface ([PROTOCOL.md](../PROTOCOL.md)).  
This document is the **HTTP status / body matrix** for second clients.

All pack routes below are under the multiword door base. The door phrase **selects
the pack** (`PACK_DIR/p_<hex>/` via DoorIndex on the reference host):

```text
BASE = http://host:port/{door}
# DOOR_OPEN=1 → BASE = http://host:port  (one shared pack)
# Create pack: POST /setup  (form field door=…)
# Open pack:   GET  /enter?door=…
```

## Public (no-door) scripture routes

Used by share targets and `route.bible` weblinks. These do **not** open a personal pack by
default; notes stay empty until the user opens with a key or mounts a local folder.

| Method | Path | Behavior |
|--------|------|----------|
| `GET` | `/go?q=<passage>` | Parse human/OSIS input → `302` to `/read/<slug>` |
| `GET` | `/read/<slug>` | BSB chapter reader (shared `_public` pack, empty notes) |
| `GET` | `/api/text/bsb/<BOOK>/<chapter>` | Immutable BSB chapter JSON (same as door path) |
| `GET` | `/api/read/<slug>` | Reader SPA bundle for public base (`BASE=""`) |
| `GET` | `/api/md/<slug>` | Raw Markdown: full chapter BSB + notes (verse slug expands to chapter) |

### `GET /api/md/<slug>` (also `/{door}/api/md/<slug>`)

Returns a **raw** Markdown document for the **whole chapter** containing `slug`
(chapter, verse, or range — always expands to book+chapter).

| Status | Body |
|--------|------|
| `200` | `text/markdown; charset=utf-8` — stitched chapter |
| `400` | `text/plain` invalid address |
| `404` | `text/plain` missing BSB chapter |

Stitch order: title → chapter note → each verse (`**N** text`) → verse note outline → range notes that **end** on that verse. Outline blocks use nested `-` lists (2 spaces per indent). Encrypted notes become `*[Encrypted note — sealed]*`. Optional `.md` suffix: `/api/md/heb.8.md`.

Wiki cross-refs in note text become Markdown links on **route.bible** OSIS slugs:

- `[[John 3:16]]` → `[John 3:16](https://route.bible/jhn.3.16)`
- `[[heb.7.28|Appointed]]` → `[Appointed](https://route.bible/heb.7.28)`
- Unresolvable `[[…]]` and embeds `![[…]]` stay raw.

Examples:

- `https://keyverse-production.up.railway.app/read/jhn.3.16`
- `https://keyverse-production.up.railway.app/go?q=John%203%3A16`
- App deep link (Expo scheme): `keyverse://read/jhn.3.16`

### Preferred library handoff (browser)

If this browser already has a multiword key in `localStorage` (`vp_door_key` — set on
enter/setup/share and whenever a pack page loads), the public `/read/<slug>` shell
validates `GET /{key}/api/protocol` and, on success, `location.replace`s to
`/{key}/read/<slug>`. Stale keys (404) are cleared so the public reader remains the
fallback. This is client-side only — server routes stay door-agnostic and cacheable.

## Discovery

### `GET /api/protocol`

No auth beyond the door path. Safe to call first for that pack.

```json
{
  "protocol": "keyverse",
  "version": "0.1-demo",
  "multipack": true,
  "door": true,
  "door_phrase": "quiet-river-lantern",
  "door_open": false,
  "cors": true,
  "max_attach_bytes": 52428800,
  "features": {
    "notes": true,
    "attachments": true,
    "encryption": true,
    "suggest": true,
    "resolve": true,
    "share_qr": true,
    "multipack": true
  },
  "endpoints": [ "…" ],
  "schemas": "schemas/",
  "docs": { "protocol": "PROTOCOL.md", "http": "docs/API.md", "llms": "llms.txt" }
}
```

| Status | When |
|--------|------|
| `200` | Door path maps to an existing pack (or open demo) |
| `404` | Unknown multiword key (generic; does not confirm existence in HTML UI) |

### `GET /api/resolve?q=<passage>`

Normalize human or slug input to a scope (no note IO).

| Status | Body |
|--------|------|
| `200` | `{ "ok": true, "q", "scope": { "kind", "osis", "slug" }, "label" }` |
| `400` | `{ "ok": false, "error": "missing q" \| "invalid passage address", "q"? }` |

Example: `GET /api/resolve?q=John+3:16` → slug `jhn.3.16`.

### `GET /api/suggest?q=<partial>&limit=8`

Passage autocomplete (same normalizer as resolve).

| Status | Body |
|--------|------|
| `200` | `{ "q", "suggestions": [{ "label", "insertText", "canonical", "kind" }] }` |

Empty `q` → empty `suggestions`. `limit` clamped 1–20 (default 8).

## Notes

### Optimistic concurrency (anti-stomp)

`PUT /api/note/<slug>` accepts an optional header:

```http
X-KV-Base-Updated-At: 2026-08-08T01:00:00.000Z
```

| Condition | Status | Body |
|-----------|--------|------|
| Header omitted | (unchanged) | Normal put |
| No on-disk note, or disk `updated_at` ≤ base | `200` | Written note / `{deleted:true}` |
| On-disk `updated_at` **>** base | **`409`** | `{ "error": "conflict", "base", "current": <note> }` |

Mobile sync sends base from the pre-sync remote list so a stale push cannot wipe
a concurrent web edit. On 409 the client **pulls `current`** and does not
retry-push in the same pass.

#### Anti-stomp shrink guard

Even without a base stamp (old clients), the door **refuses severe content
shrinks** unless the writer opts in:

```http
X-KV-Allow-Shrink: 1
```

| Write | Without allow-shrink | With allow-shrink |
|-------|----------------------|-------------------|
| Richer or equal body | `200` | `200` |
| Full delete (blank blocks + `attachments: []`) | `200` `{deleted:true}` | `200` |
| Thin/empty body over multi-line note | **`409` `{error:"shrink_rejected", current}`** | `200` |

User editors (web outliner, mobile save) always send `X-KV-Allow-Shrink: 1`.
Bulk quietSync **must not**. See [ADR 0022](./adr/0022-sync-anti-stomp.md).

### `GET /api/notes`

Every note in the pack (full records). Sorted by `updated_at` descending.

| Status | Body |
|--------|------|
| `200` | JSON array of note records |

No pagination in v0.1.

### `GET /api/note/<slug>`

| Query / header | Effect |
|----------------|--------|
| `?raw` or `Accept: text/plain` | Block interchange text (`indent`/`text` only; not `collapsed`) |

| Status | Body |
|--------|------|
| `200` | Note JSON, or `text/plain` when raw |
| `400` | `{ "error": "invalid passage address" }` |
| `404` | `{ "error": "no note at this address" }` |
| `409` | `{ "error": "encrypted", "message": "…" }` — raw requested on sealed note |

Non-canonical slugs are accepted if `parseScope` can normalize them (response scope uses canonical slug).

### `PUT /api/note/<slug>`

Supports optional `X-KV-Base-Updated-At` (see [Optimistic concurrency](#optimistic-concurrency-anti-stomp) above).

Create, update, seal, or delete.

| Content-Type | Body | Result |
|--------------|------|--------|
| `application/json` | `{ "blocks": […], "attachments"?: […] }` | Store plaintext note |
| `application/json` | `[{…blocks…}]` | Same (array = blocks) |
| `application/json` | `{ "encrypted": true, "cipher": {…} }` | Seal note |
| other / plain | raw interchange text | LCS-reconcile block ids from previous text |

**Attachments rule (plaintext JSON):** omit `attachments` → **preserve** existing (unless previous note was encrypted → preserve empty). Explicit array replaces.

**Delete:** empty / all-blank plaintext blocks **and** no attachments → delete file; response `{ "deleted": true, "slug" }`.

| Status | Body |
|--------|------|
| `200` | Stored note JSON, or `{ "deleted": true, "slug" }` |
| `400` | invalid address / JSON / cipher envelope |
| `409` | raw text PUT against sealed note |

Plaintext JSON PUT against a sealed note **unwraps** it (client decrypted and is saving cleartext).

Block ids: clients SHOULD send stable ids (`^[\w.-]+$`). Duplicates/missing → server assigns new `b_…` ids. Indent clamped 0–32 and at most +1 vs previous row.

## Attachments

### `POST /api/note/<slug>/attachments`

Creates the note if missing (blank bullet).

| Content-Type | Body | Headers |
|--------------|------|---------|
| `application/json` | `{ "kind": "url", "url": "https://…", "title"?: "…" }` | — |
| any other | raw file bytes | `X-Filename` optional; `Content-Type` → mime |

| Status | Body |
|--------|------|
| `200` | Full note (plaintext) **or** `{ "encrypted": true, "attachment": {…} }` if sealed |
| `400` | invalid address / JSON / empty body / non-http(s) URL |
| `413` | body larger than `MAX_ATTACH_BYTES` |

Sealed notes: file blobs are still written to CAS; metadata is **not** written into the cipher. Client must fold `attachment` into the next encrypted PUT.

### `DELETE /api/note/<slug>/attachments/<att_id>`

| Query | Effect |
|-------|--------|
| `?sha256=<hex>` | Best-effort blob GC when note is sealed (metadata not on disk) |

| Status | Body |
|--------|------|
| `200` | Updated note, or `{ "encrypted": true, "removed": "<id>" }` |
| `400` | invalid address |
| `404` | no note |

Unreferenced file blobs are GC’d when safe (plaintext path).

### `GET /api/attachments/<sha256>`

Raw bytes. `?name=` optional download name.

| Status | Body |
|--------|------|
| `200` | bytes; `Content-Type` from a referencing note when known |
| `400` | invalid hash |
| `404` | blob missing |

## Activity (contribution graph)

Heatmap of note edits over time, driven primarily by `ops/**` wall-clock `at`
(PROTOCOL §10) and falling back to note `created_at` / `updated_at` when a
slug has no op log. UI: `GET /{door}/activity` (web) and the mobile Activity
screen.

### `GET /api/activity`

Heatmap defaults to **calendar YTD** (UTC Jan 1 → today). Optional `?days=N` for a trailing window.

| Status | Body |
|--------|------|
| `200` | `{ days: [{ date, count, level }], total, notes_taken_ytd, ytd_from, ytd_to, from, to, source, canon }` |

`level` is 0–4 (GitHub-style intensity). `source` is `ops`, `notes`, or `mixed`.  
`notes_taken_ytd` is unique notes first written year-to-date — used for the activity lead.

**`canon`** — coverage rail (book-width segments, chapter-weighted):

```json
{
  "books": [
    {
      "osis": "JHN",
      "name": "John",
      "chapters": 21,
      "notes": 4,
      "ratio": 0.1905,
      "heat": 0.1714,
      "t0": 0.82,
      "t1": 0.84
    }
  ],
  "testament_seam_t": 0.781328,
  "total_chapters": 1189,
  "total_notes": 12,
  "books_with_notes": 5,
  "heat_scale": { "notes_per_chapter_at_90": 1.0 }
}
```

Heat is continuous `0..1`:

```text
heat = min(1.0, 0.9 * notes / chapters)
```

so **1 note per chapter → 90% hot**. Empty drafts do not count; sealed / contentful notes do.

### `GET /api/activity?date=YYYY-MM-DD`

Day detail. Op-backed events include `before_text` / `after_text` (outline form)
for line diffs; `has_diff` is true when those differ.

| Status | Body |
|--------|------|
| `200` | `{ date, count, events: [{ kind, slug, label, at, summary, before_text, after_text, has_diff, … }] }` |
| `400` | invalid date |

## Pack ownership (export / import)

User-owned transfer profile. See [OWNERSHIP.md](./OWNERSHIP.md).

### `GET /api/pack`

Manifest of the current pack (counts + export include list).

| Status | Body |
|--------|------|
| `200` | `{ protocol, door, notes, attachments, attachment_bytes, user_owned, export }` |

### `GET /api/pack/export`

Zip of user data only: `protocol.json`, `door`, `notes/**`, `attachments/**`,
`ops/**`.

| Status | Body |
|--------|------|
| `200` | `application/zip` (`Content-Disposition: attachment`) |
| `400` | `{ "error": "…" }` empty/unreadable pack |

### `POST /api/pack/import?mode=merge|replace`

Restore a pack zip into this door’s directory.

- **Body:** multipart field `pack` (file) **or** raw `application/zip` body
- **mode=merge** (default): overwrite paths present in the zip
- **mode=replace:** clear `notes/` and `attachments/` first

| Status | Body |
|--------|------|
| `200` | `{ ok: true, mode, files, manifest }` |
| `400` | missing/invalid zip |
| `422` | `{ ok: false, error: "conformance_failed", errors: […] }` |

## Host metrics

### `GET /health`

Liveness + short metrics summary (`metrics.put_p95_ms`, `pack_count`, …).

### `GET /metrics`

JSON snapshot: per-op counts/errors, latency p50/p95/p99, `user_data_bytes`,
active pack writers, uptime. Not Prometheus text format (yet).

## Progressive web app (shell)

These are **outside** the door path (except door-scoped manifest) so the browser
can install and cache the app shell.

| Path | Role |
|------|------|
| `GET /sw.js` | Service worker (`scope: /`) |
| `GET /manifest.webmanifest` | Manifest; `start_url` = door home when door enabled |
| `GET /{door}/manifest.webmanifest` | Same, scoped to pack home |
| `GET /icons/*` | 192/512 (any + maskable), apple-touch, favicon, SVG |
| `GET /offline` | Offline fallback HTML |

Writes still require network (no offline op queue in v0.1). GET navigations and
API GETs are network-first with cache fallback via the service worker.

## UX helper

### `GET /api/share-qr?origin=<url-origin>&path=<optional>`

SVG QR for a door URL. Door-only. Passage deep-link policy:
[ADR 0019](./adr/0019-passage-deep-link-sharing.md).

| Query | Effect |
|-------|--------|
| `origin` | Browser origin (e.g. `https://host`). When omitted, derived from `Forwarded` / `Host`. |
| `path` | Optional deep link under the door. Default `/` (pack home). Allowed: `/`, `/note/<slug>`, `/read/<slug>`. Invalid path → `400`. |

Examples:

- pack home → `{origin}/{door}/`
- passage (projected reader) → `{origin}/{door}/read/jhn.3.16`

| Status | Body |
|--------|------|
| `200` | `image/svg+xml` |
| `400` | `{ "error": "invalid path" }` |
| `404` | plain text `no door` when `DOOR_OPEN` |
| `500` | QR generation failed |

## CORS

API routes (`/api/*`) send CORS headers by default so browser SPAs can use the door:

| Env | Effect |
|-----|--------|
| *(unset)* | `Access-Control-Allow-Origin: *` |
| `CORS_ORIGIN=*` | same |
| `CORS_ORIGIN=https://app.example.com` | that origin (comma-list allowed) |
| `CORS_ORIGIN=off` | no CORS headers |

Preflight: `OPTIONS /api/…` → `204`.

Allowed methods: `GET, PUT, POST, DELETE, OPTIONS`.  
Allowed headers: `content-type, x-filename, accept`.

**Access control is the multiword door path**, not cookies. Treat the full door URL as a secret.

## Error shape

JSON errors are usually:

```json
{ "error": "short_code_or_message", "message": "optional human text" }
```

Not every path uses both fields; clients should check HTTP status first.

## Minimum client checklist

1. Read `GET /api/protocol` (or `pack/protocol.json` offline).  
2. Normalize addresses with `GET /api/resolve?q=` or the same BCV rules as `grab-bcv`.  
3. List: `GET /api/notes`.  
4. Read: `GET /api/note/<slug>`.  
5. Write: `PUT` with `{ "blocks": […] }`; **preserve** `id`s and omit `attachments` to keep files.  
6. Handle `409` on sealed notes (prompt passphrase; never send passphrase to server).  
7. Attach: `POST …/attachments`; if response has `encrypted: true`, re-encrypt note with new metadata.  
8. Ignore unknown JSON keys on read.  
9. Prefer pack filesystem when co-located; HTTP is optional.  
10. Offer or consume export/import zip for user-owned backup ([OWNERSHIP.md](./OWNERSHIP.md)).

Schemas: [../schemas/](../schemas/). Fixtures: [../protocol/](../protocol/). Agent index: [../llms.txt](../llms.txt).
