# keyverse protocol v0.2

> Supersedes `0.1-demo` additively (ignore-unknown). Older packs with `version: "0.1-demo"` remain valid.

keyverse is a *pack format*, not an app. The protocol is: how notes are
addressed, how they are laid out on disk, and what a record contains. Anything
that reads and writes a conforming pack directory is a keyverse client — the
bundled server is just the reference client (a door). Two clients pointed at
the same pack interoperate with no coordination beyond the filesystem.

### Layers (ADR 0014)

| Layer | What | Normative? |
|-------|------|------------|
| **Pack core** | OSIS address, note JSON, CAS attachments, cipher envelopes, `protocol.json` | **Yes** — this document + `schemas/` |
| **Conformance** | Offline fixture validation (`protocol/fixtures`, `mix keyverse.conformance`) | Yes for CI / second clients |
| **Door HTTP profile** | Optional `/{door}/api/…` matrix | [docs/API.md](docs/API.md) |
| **Ownership transfer** | Export/import zip of user data | [docs/OWNERSHIP.md](docs/OWNERSHIP.md) |
| **Host runtime** | Elixir (or any) multipack process | Replaceable |

User-owned data is critical: a pack or export zip must remain complete with the
door offline. Disposable scripture cache is never user data.

| Audience | Start here |
|----------|------------|
| Machines / LLMs | [llms.txt](llms.txt) |
| Ownership / export | [docs/OWNERSHIP.md](docs/OWNERSHIP.md) |
| HTTP status matrix | [docs/API.md](docs/API.md) |
| JSON Schema | [schemas/](schemas/) |
| Fixtures | [protocol/](protocol/) |
| Runtime discovery | `GET /{door}/api/protocol` |

## 1. Addressing

Every note is addressed by a canonical scripture scope, not a title or key.

- Canonical form: OSIS (`JHN.3.16`, `JHN.3.16-18`, `1JN.1`).
- Slug: the OSIS string lowercased (`jhn.3.16-18`). Slugs are filenames and URL
  path segments.
- Scope kinds: `verse`, `range` (same-chapter in v0.1), `chapter`.
- Clients MUST normalize human input ("John 3:16", "1jn 1") to canonical form
  before addressing. The reference client uses `grab-bcv`.

One address, at most one note. The address *is* the identity of the page;
the note's `id` is the durable identity of the record (it survives nothing in
v0.1 — reserved for the op-log extension).

## 2. Pack layout

A **pack** is one library of notes. On a multipack host, each multiword key is
its own pack directory:

```
packs/                         multipack root (PACK_DIR)
  quiet-river-lantern/         one pack = one multiword key
    protocol.json              {"protocol":"keyverse","version":"0.2","schemas":"schemas/"}
    door                       same phrase (optional; for portability)
    notes/<slug>.json          one record per addressed note
    attachments/<sha256>       content-addressed file bytes
  stone-path-ember-wind/       another user's (or project's) pack
    …
  _cache/text/bsb/             shared disposable scripture cache (not user data)
```

A single pack directory (offline / import) still looks like:

```
pack/
  protocol.json
  door
  notes/<slug>.json
  attachments/<sha256>
```

Repo-root `schemas/` holds JSON Schema for protocol manifest, notes, attachments,
and cipher envelopes. Clients MUST ignore unknown properties.

- The pack MUST remain fully readable with no server running: plain JSON,
  UTF-8, pretty-printed, newline-terminated for notes; attachment binaries are
  opaque bytes named by lowercase hex SHA-256 of their content.
- Deleting a note = deleting its file. An empty body write MUST delete the note
  record when there is also no attachment content; clients SHOULD
  garbage-collect unreferenced `attachments/*` when safe.
- Scripture text cache MAY live inside the pack or be shared host-wide under
  `_cache/`; it is disposable and never user data.
- `door` records the multiword key for HTTP access; the key is also the pack
  directory name on multipack hosts.

## 3. Note record

```json
{
  "id": "note_…",
  "scope": { "kind": "verse", "osis": "JHN.3.16", "slug": "jhn.3.16" },
  "blocks": [ { "id": "b_…", "indent": 0, "text": "…" } ],
  "attachments": [
    {
      "id": "att_…",
      "kind": "file",
      "name": "scan.pdf",
      "mime": "application/pdf",
      "sha256": "hex…",
      "bytes": 12345,
      "created_at": "ISO-8601"
    },
    {
      "id": "att_…",
      "kind": "url",
      "url": "https://example.com/essay",
      "title": "optional label",
      "created_at": "ISO-8601"
    }
  ],
  "created_at": "ISO-8601",
  "updated_at": "ISO-8601"
}
```

- `attachments` is optional; omit or use `[]` when none. Order is display order.
- Legacy records may carry `body` (a flat string) instead of `blocks`; clients
  MUST hydrate `body` into blocks on read (one block per line, indent = leading
  spaces / 2) and SHOULD write `blocks` on next save.
- Clients that only update `blocks` MUST preserve existing `attachments` unless
  the write intentionally replaces them.

### 3.1 Encrypted note (optional, client-side)

A note MAY be sealed with a **client-side passphrase** (cowyo-style). The server
and pack store only ciphertext; the passphrase never leaves the browser.

```json
{
  "id": "note_…",
  "scope": { "kind": "verse", "osis": "JHN.3.16", "slug": "jhn.3.16" },
  "encrypted": true,
  "cipher": {
    "v": 1,
    "alg": "AES-GCM",
    "kdf": "PBKDF2",
    "iter": 210000,
    "salt": "<base64>",
    "iv": "<base64>",
    "ct": "<base64>"
  },
  "blocks": [],
  "attachments": [],
  "created_at": "ISO-8601",
  "updated_at": "ISO-8601"
}
```

- When `encrypted` is true, `cipher` is required. `blocks` and `attachments` on
  disk MUST be empty arrays (or omitted); plaintext lives only inside `ct`.
- Plaintext payload (UTF-8 JSON before AES-GCM) is:
  `{"blocks":[…], "attachments":[…]}` — same shapes as the unencrypted note.
- KDF: PBKDF2-HMAC-SHA-256, 210000 iterations, 16-byte salt, AES-256-GCM,
  12-byte IV. Reference client uses Web Crypto.
- File **blobs** under `attachments/<sha256>` remain content-addressed bytes;
  only the metadata that points at them is sealed. Knowing a hash still fetches
  the blob if the door is open — treat encryption as note privacy, not blob
  secrecy.
- Multiword door (URL access) and pack passphrase are independent: door = who
  can hit the HTTP surface; passphrase = who can read sealed note content.

## 4. Blocks (miniature outline)

A note's content is a flat, ordered list of line-blocks. The outline tree is a
projection of `indent`; it is never stored nested.

- `id`: stable across edits. A client editing text MUST preserve the ids of
  surviving lines (the reference client uses LCS line matching). Ids are the
  hook for merge, transclusion, and the future op log.
- `indent`: non-negative integer, at most one deeper than the previous block
  when projected.
- `text`: one line, no newlines. Markers for inline formatting stay **in the
  string** (source of truth); clients render them for display.
- `collapsed` (optional boolean): when true, clients SHOULD hide this block's
  descendants until expanded. Only meaningful when the block has children in
  the indent projection. Omitted or `false` = expanded. JSON notes only —
  text interchange does **not** encode collapse; a text PUT may drop it
  ([ADR 0013](docs/adr/0013-outline-collapse-and-structural-ops.md)).
- Interchange form: `"  ".repeat(indent) + text` joined by `\n`. Parsing and
  serializing MUST round-trip for `indent`/`text` (not `collapsed`).

### 4.0 Inline markdown (base)

Clients SHOULD render these flat (non-nested) inline forms when showing notes
to humans. Storage is always the literal markers (dotflowy-style), never HTML.

| Form | Renders as |
|------|------------|
| `` `code` `` | monospaced |
| `**bold**` | strong |
| `*italic*` or `_italic_` | emphasis (`snake_case` stays literal) |
| `~~strike~~` | strikethrough |
| `[label](https://…)` | external link (http/https only) |
| `[[…]]` / `![[…]]` | wiki / embed (§4.1, §5) |

Rules:

- Flat only: no nested emphasis (`***` is not bold+italic).
- Code spans are opaque (`` `**not bold**` `` stays literal inside).
- The reference editor shows **source while a line is focused**, and rendered
  markdown when idle. Readers always show rendered form.
- Clients that cannot render MAY show raw markers.

### 4.1 Cross-references (wiki links)

Cross-references are **in-band** in block `text`. No separate link table is
required for v0.1; the address space *is* the link target space.

**Syntax** (one line; no nested brackets):

| Form | Meaning |
|------|---------|
| `[[John 3:16]]` | Link to that passage address; label = inner text |
| `[[jhn.3.16]]` | Same, using slug/OSIS-ish input |
| `[[John 3:16\|loved the world]]` | Link with explicit display label |

Rules:

- Clients MUST treat `[[…]]` as a cross-ref when rendering human-facing views.
- The target MUST be resolved with the same passage normalizer as addressing
  (`grab-bcv` in the reference client). Unresolvable targets SHOULD still render
  as links to a human “go” entrypoint (or as plain text if the client has none).
- Resolved targets use the canonical **slug** (`jhn.3.16`) for navigation
  (`/note/<slug>` or equivalent). Opening a missing note is allowed (empty door).
- Stored text MAY keep the author’s original inner form; clients MAY rewrite to
  canonical OSIS/slug on save but are not required to.
- Pipe (`|`) separates target from label. Targets and labels MUST NOT contain
  `]` or newlines.
- Containment projection (section 5) is orthogonal: a wiki link is an explicit
  pointer; compose-don’t-absorb still never copies note bodies.

Backlinks (notes that link *to* an address) are a derived index; clients MAY
compute them by scanning block text. Not stored in v0.1.

## 5. Attachments (files and URLs)

Notes MAY attach **any file type** and/or **external URLs**. Attachments are
first-class pack data, not a separate product.

### 5.1 Kinds

| `kind` | Bytes on disk | Required fields |
|--------|---------------|-----------------|
| `file` | `attachments/<sha256>` | `id`, `name`, `mime`, `sha256`, `bytes` |
| `url`  | none | `id`, `url` |

- `id`: stable attachment id (`att_…`), unique within the note.
- `sha256`: lowercase hex SHA-256 of file bytes; path segment for the blob.
- `mime`: IANA media type (or `application/octet-stream`).
- `name`: original filename for download UX; not used as the storage key.
- `url`: absolute URL (`http:` / `https:` required in v0.1).
- `title`: optional display label for URLs (and MAY be used for files).
- Any other fields are reserved; clients MUST ignore unknown keys.

There is **no** allowlist of MIME types: audio, video, PDF, images, archives,
office docs, and unknown binaries are all valid. Clients MAY refuse to *render*
a type inline while still storing and offering download.

### 5.2 Content addressing

File bytes are stored once under `attachments/<sha256>`. Multiple notes (or
multiple attachment rows) MAY reference the same hash. Deleting a note does not
require deleting the blob until no note references that hash (GC is optional).

### 5.3 In-band pointers (optional)

Block text MAY reference attachments or bare URLs for inline display:

| Form | Meaning |
|------|---------|
| `![[att:att_…]]` | Embed/link the attachment with that id on this note |
| `![[att:att_…\|caption]]` | Same with caption |
| `![[https://example.com/x]]` | External URL embed/link |
| `![[https://…\|title]]` | URL with label |

Clients that do not understand embeds MUST still leave the source text intact.
The `attachments` array remains the authoritative list of files on the note;
in-band forms are presentation hints (and for URLs, may stand alone without an
array entry).

### 5.4 Portability

A conforming pack with attachments is still fully offline-readable: JSON notes
plus files under `attachments/`. URL attachments need network only when
followed. Copying a pack copies note metadata and all referenced blobs.

## 6. Containment (compose, don't absorb)

Scripture geometry is computed, never stored. A scope maps to an interval on
the book's (chapter, verse) line; chapter scopes span the whole chapter.
Given two scopes in one book: `contains`, `within`, `overlaps`, or disjoint.

Clients SHOULD use containment to *project* related notes into a view (a range
page shows the verse notes inside it; a chapter reading view interleaves them
verse by verse). Clients MUST NOT copy, merge, or reparent records to achieve
this: every note keeps its own address, file, and block ids.

## 7. HTTP door (optional)

### 7.0 Multiword access (pack identity)

Serving clients SHOULD map a **multiword door** path segment to a pack
(cowyo-style): `/{door}/note/jhn.3.16`. The phrase **is** the pack key — each
distinct phrase is a distinct pack. Knowing the door URL is access to that pack
only. Creating a new key creates a new empty pack. Clients MUST prefix API and
page routes with the door base for that pack.

A serving client SHOULD expose (under `/{door}/` when enabled). Full status/body
matrix: [docs/API.md](docs/API.md).

- `GET /api/protocol` — pack/protocol discovery: `{ protocol, version, door,
  features, endpoints, … }`. Clients SHOULD call this first over HTTP.
- `GET /api/resolve?q=<passage>` — normalize human/slug input to
  `{ ok, scope: { kind, osis, slug }, label }` without reading notes. Same
  normalizer as addressing (`grab-bcv` in the reference client).
- `GET /api/notes` — every record in the pack (reference sort: `updated_at` desc).
- `GET /api/suggest?q=<partial>&limit=8` — passage reference autocomplete
  (book / chapter / verse / range). Response:
  `{ "q": "…", "suggestions": [{ "label", "insertText", "canonical", "kind" }] }`.
  Powered by the same BCV library used for addressing; empty `q` → empty list.
- `GET /api/note/<slug>` — one record; `?raw` (or `Accept: text/plain`) returns
  the block interchange form as `text/plain`.
- `PUT /api/note/<slug>` — body is either:
  - raw interchange text (`text/plain`), or
  - `{"blocks":[...], "attachments"?: [...]}` (`application/json`), or
  - `{"encrypted":true,"cipher":{…}}` (sealed envelope; see §3.1).
  Empty / all-blank plaintext body (no content blocks, no attachments) deletes
  the note. Response is the stored record (or `{deleted:true}`). Omitting
  `attachments` in plaintext JSON MUST preserve existing attachments (unless
  the previous record was encrypted — then preserve is empty). Encrypted PUT
  replaces the whole record with ciphertext (no plaintext blocks/attachments).
  Plaintext PUT to a sealed note is allowed and **unwraps** it (client decrypted
  and is saving cleartext). Raw text PUT against a sealed note SHOULD return
  `409 encrypted`.
- `POST /api/note/<slug>/attachments` — add one attachment:
  - JSON `{ "kind":"url", "url":"…", "title"?: "…" }`, or
  - raw body with `Content-Type` + optional `X-Filename` for a file (any type).
  Creates the note if missing. Response is the updated note. If the note is
  already encrypted, the server MUST NOT write plaintext metadata onto the note;
  for files it still stores the CAS blob and returns
  `{ "encrypted": true, "attachment": {…} }` so the client can fold metadata
  into the next cipher PUT.
- `DELETE /api/note/<slug>/attachments/<att_id>` — remove that attachment row
  from the note (blob GC optional). On encrypted notes, returns
  `{ "encrypted": true, "removed": "<id>" }` without mutating the cipher; client
  re-encrypts. Optional `?sha256=` triggers best-effort blob GC.
- `GET /api/attachments/<sha256>` — raw file bytes (`Content-Type` from a
  referencing note when known, else `application/octet-stream`).
- `GET /api/share-qr?origin=<url-origin>&path=<optional>` — SVG QR for this pack’s
  door URL. Default path is pack home (`{origin}/{door}/`). Optional `path` may be
  `/note/<slug>` or `/read/<slug>` for a passage deep link (invalid path → 400).
  `origin` SHOULD be the browser’s `location.origin`; when omitted, derived from
  `Forwarded` / `Host`. Door-only (404 when the door is open/disabled).
  Response: `image/svg+xml`. Used by the home share popup and passage share.
  Sharing policy (default = projected `/read/{slug}`): [ADR 0019](docs/adr/0019-passage-deep-link-sharing.md).

### 7.1 CORS (browser clients)

Serving clients that expect cross-origin SPAs SHOULD send CORS headers on
`/api/*` (including `OPTIONS` preflight → 204). The reference door defaults to
`Access-Control-Allow-Origin: *` (access control is the multiword door path).
Disable with `CORS_ORIGIN=off`, or restrict with `CORS_ORIGIN=https://app.example`
(comma-separated list allowed).

## 8. Minimum client checklist

1. Read `pack/protocol.json` or `GET /api/protocol`.
2. Normalize every address (same BCV rules as the door, or `GET /api/resolve`).
3. List notes (`notes/*.json` or `GET /api/notes`).
4. Read/write note JSON; preserve block `id`s and attachment rows when editing text.
5. Treat empty plaintext + no attachments as delete.
6. Handle sealed notes without sending a passphrase to the server (`409` on raw).
7. Ignore unknown keys; optionally validate with `schemas/` or `mix keyverse.conformance`.
8. Prefer pack directory or export zip for backup — not host-only APIs
   ([docs/OWNERSHIP.md](docs/OWNERSHIP.md)).

## 8.1 User-owned transfer (door profile)

When speaking HTTP, doors SHOULD offer:

- `GET /api/pack` — manifest (counts, protocol version)
- `GET /api/pack/export` — zip of `protocol.json`, `door`, `notes/`, `attachments/`
- `POST /api/pack/import?mode=merge|replace` — restore zip (conformance after write)

Scripture cache paths MUST NOT appear in exports.

## 9. Reserved extensions (not fully specified in v0.1)

**In v0.1 already:** attachments (CAS + URLs), multiword door access, client-side
note encryption (§3.1), protocol discovery, resolve, CORS, JSON Schema.

**Reserved / deferred** (layer *under* the pack; must not change addressing or
the no-account capture surface):

- Op log + deterministic block-level merge  
- Multi-device envelope key exchange / shared sealed packs  
- Server-side encryption at rest; full attachment-blob encryption  
- PAKE device pairing  
- Relay sync / resumable transfer  
- Arweave (or similar) permanence  

See ADRs 0008, 0010–0012.
