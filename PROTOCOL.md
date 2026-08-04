# keyverse protocol v0.3

> Supersedes `0.2` additively (ignore-unknown): adds the append-only op log
> (§10, ADR 0020). Older packs with `version: "0.2"` or `"0.1-demo"` remain
> valid; `ops/` is optional.

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
the note's `id` is the durable identity of the record. The op log (§10) keys
on the address slug and block ids, not the note id.

## 2. Pack layout

A **pack** is one library of notes. On a multipack host, each multiword key is
its own pack directory:

```
packs/                         multipack root (PACK_DIR)
  quiet-river-lantern/         one pack = one multiword key
    protocol.json              {"protocol":"keyverse","version":"0.3","schemas":"schemas/"}
    door                       same phrase (optional; for portability)
    notes/<slug>.json          one record per addressed note
    attachments/<sha256>       content-addressed file bytes
    ops/<slug>/<sha256>.json   append-only op log (optional, §10)
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
  ops/<slug>/<sha256>.json
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
  hook for merge, transclusion, and the op log (§10).
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
9. Optional: read/write the op log (§10) for lossless concurrent-edit merge.
   Snapshot-only clients stay conformant; they MUST simply preserve `ops/`
   files they don't understand (never delete or rewrite them).

## 8.1 User-owned transfer (door profile)

When speaking HTTP, doors SHOULD offer:

- `GET /api/pack` — manifest (counts, protocol version)
- `GET /api/pack/export` — zip of `protocol.json`, `door`, `notes/`,
  `attachments/`, `ops/`
- `POST /api/pack/import?mode=merge|replace` — restore zip (conformance after
  write). Merge unions op records by hash (§10.7).

Scripture cache paths MUST NOT appear in exports.

## 9. Reserved extensions (not fully specified)

**Already specified:** attachments (CAS + URLs), multiword door access,
client-side note encryption (§3.1), protocol discovery, resolve, CORS, JSON
Schema, append-only op log + deterministic block-level merge (§10, v0.3).

**Reserved / deferred** (layer *under* the pack; must not change addressing or
the no-account capture surface):

- Op-log checkpoints / tombstone GC (§10.9)
- Sync transport for op records (relay, push, resumable transfer)
- Multi-device envelope key exchange / shared sealed packs
- Server-side encryption at rest; full attachment-blob encryption
- PAKE device pairing
- Arweave (or similar) permanence

See ADRs 0008, 0010–0012, 0020.

## 10. Append-only op log (optional, v0.3)

The op log makes concurrent editing lossless: two clients that edit the same
note while disconnected converge to identical state by *file-set union*, with
no server, no negotiation, and no live protocol. It layers **under** the pack:
`notes/<slug>.json` stays the canonical projection for snapshot-only clients
(§2, §3), and a pack with no `ops/` directory is fully conformant.

Design decision record: [ADR 0020](docs/adr/0020-append-only-op-log.md).
Machine shape: [schemas/op.schema.json](schemas/op.schema.json).

### 10.1 Layout and content addressing

```
ops/<slug>/<sha256>.json
```

- One file per **op record**. Files are immutable: clients MUST NOT modify or
  delete an existing record file (checkpoint/GC is reserved, §10.9).
- The file bytes are exactly the canonical JSON encoding (§10.2) of the
  record. The filename is the lowercase hex SHA-256 **of the file bytes**,
  so `shasum -a 256 <file>` verifies any record and identical records dedupe
  to one file. Writers MUST NOT pretty-print op records.
- `<slug>` is the note slug (§1) and MUST equal the record's `slug` field.
- Appending = creating a file. On a plain filesystem this is naturally
  conflict-free; merging two logs is copying the union of files.

### 10.2 Canonical JSON

The canonical encoding of a record is defined by:

1. Objects: keys sorted bytewise ascending (UTF-8), no duplicate keys.
2. Arrays: element order preserved.
3. No insignificant whitespace.
4. Strings: standard JSON escaping for `"`, `\`, and control characters
   (U+0000–U+001F); all other characters as raw UTF-8 (no `\uXXXX` escaping
   of non-ASCII).
5. Numbers: op records use only non-negative integers, encoded in minimal
   decimal form (no sign, no fraction, no exponent, no leading zeros).

Reference implementation: `Keyverse.CanonicalJson`.

### 10.3 Record shape

```json
{
  "v": 1,
  "slug": "jhn.3.16",
  "parents": ["<sha256>", "…"],
  "lamport": 4,
  "at": "ISO-8601",
  "ops": [ { "op": "…", "…": "…" } ]
}
```

| Field | Rule |
|-------|------|
| `v` | MUST be `1` |
| `slug` | MUST equal the `ops/<slug>/` directory name |
| `parents` | Hashes of the records this one causally follows — the writer's view of the log frontier (§10.3.1). `[]` for a root record. |
| `lamport` | Integer ≥ 1: `max(lamport of all records the writer has seen for this note) + 1` |
| `at` | Wall-clock creation time. **Informational only — MUST NOT affect ordering.** Optional. |
| `implicit` | Optional boolean; `true` marks a record synthesized from an out-of-band snapshot edit (§10.5) |
| `ops` | Non-empty array of primitive ops (§10.4.2), applied atomically in order |

Unknown record fields MUST be ignored on read (and, being part of the file
bytes, are preserved by content addressing automatically).

#### 10.3.1 Heads and parents

The **heads** of a log are the record hashes not referenced by any record's
`parents`. A writer appending a record sets `parents` to the heads it can see.
Two writers appending concurrently produce two records with the same parents —
a fork; the next append (by whoever sees both) lists both as parents — a join.
Records whose parents are not present in the set are legal (a partially copied
log still folds deterministically); validators SHOULD warn on dangling
parents, not fail.

### 10.4 Deterministic fold

The materialized state of a note is a **pure function of the set of records**
in `ops/<slug>/`. Any two implementations holding the same files MUST produce
identical state.

#### 10.4.1 Linearization

1. Order records topologically: every record after all of its `parents` that
   are present in the set (absent parents impose no constraint).
2. Among records whose constraints are satisfied ("ready"), always take the
   least by the pair `(lamport, hash)` — integer compare, then bytewise
   compare of the lowercase hex hash.

This yields a total order. Replay each record's `ops` array in file order.

#### 10.4.2 Primitive ops (total semantics — no op may fail)

Fold state is a list of blocks (each `{id, indent, text, collapsed?, deleted}`,
where `deleted` marks a tombstone) plus an ordered attachment list. Field
sanitization applies on replay: `indent` clamps to `0..32` (non-integers →
`0`), `text` coerces to string with newlines replaced by spaces.

| Op | Required fields | Semantics |
|----|-----------------|-----------|
| `insert` | `block`, `after`, `indent`, `text` (+ optional `collapsed`) | If a block with this id already exists (live **or tombstone**): no-op. Else insert per the anchor rule below. |
| `set_text` | `block`, `text` | Replace the block's whole text (block-level LWW). Unknown id: no-op. Works on tombstones. |
| `set_indent` | `block`, `indent` | Replace indent. Unknown id: no-op. |
| `set_collapsed` | `block`, `collapsed` | `true` sets the flag; anything else clears it. Unknown id: no-op. |
| `move` | `block`, `after` | Remove the block from its position and re-place per the anchor rule. Unknown id: no-op. |
| `delete` | `block` | Mark the block as a tombstone (it keeps its list position). Unknown id: **append a tombstone** with that id at the end, so later anchors on it resolve. |
| `put_attachment` | `attachment` (an attachment row, §5) | Remove any attachment with the same `id`, then append this row at the end. Attachment order = display order. |
| `remove_attachment` | `id` | Remove the attachment row with that id (later `put_attachment` may re-add it). |

**Anchor rule** (`after`): `null` → place at the head of the list; a block id
→ immediately after that block (tombstones count — deleted blocks still
anchor); an id not in the list → append at the end.

Unknown `op` names and structurally malformed primitives MUST be treated as
no-ops (forward compatibility). Validators SHOULD warn on unknown primitives,
not fail.

#### 10.4.3 Materialization

To produce the note-shaped state (§3) from fold state:

1. Drop tombstoned blocks; drop the internal `deleted` flag.
2. Clamp indent to the +1-step rule (§4): each block's indent becomes
   `min(indent, previous_block_indent + 1)`; the first block clamps to `0`.
3. Attachments: the remaining rows in list order.

Two clients holding the same record set MUST materialize structurally equal
`blocks` and `attachments`.

Because block text is whole-line LWW, concurrent edits *to the same block's
text* keep one wording (deterministically); structure (which blocks exist,
where, with what children) always converges losslessly. This is deliberate:
blocks are the product's atom (ADR 0003), not characters.

### 10.5 Snapshot ↔ log relationship

- `notes/<slug>.json` remains authoritative for snapshot-only clients and for
  human inspection. A log-aware writer keeps them consistent: after a logged
  edit, the snapshot's `blocks`/`attachments` MUST equal the fold's
  materialization. Record metadata (`id`, `scope`, timestamps) lives only in
  the snapshot, not the log.
- **Implicit reconciliation.** Before logging an edit, a log-aware writer
  folds the existing log and compares it to the current snapshot. If they
  differ, a snapshot-only client edited out-of-band; the writer MUST first
  append a record with `"implicit": true` whose ops transform the fold state
  into the snapshot state, then append its own edit on top. Nothing a
  snapshot-only client wrote is ever discarded by a log-aware client.
- Between reconciliations, two *snapshot-only* clients can still overwrite
  each other (that is 0.2 behavior); the log bounds the loss to the
  un-reconciled window instead of eliminating it.
- Crash model: the reference writer writes the snapshot first, then the op
  record(s); a failed log write is logged and healed by the next
  reconciliation. Writers MUST hold the pack's single-writer lock (or
  equivalent) across fold + append + snapshot for one pack.
- Deleting a note (empty write, §2) is logged as `delete` ops for its blocks
  and `remove_attachment` ops for its rows; the log directory persists so a
  concurrent editor's ops still merge against the tombstones.

### 10.6 Sealed notes (§3.1)

Encrypted notes MUST NOT emit plaintext op records — logging ops for sealed
content would leak edit structure. While a note is sealed, its log is frozen
and the cipher envelope is whole-record LWW, as in 0.2. When a plaintext write
unwraps a sealed note, the writer diffs **from the fold of the frozen log** to
the new plaintext state (there is no plaintext "before" to compare), appending
one record that catches the log up.

### 10.7 Export / import

- `ops/` is user data: export zips MUST include it (§8.1,
  [docs/OWNERSHIP.md](docs/OWNERSHIP.md)).
- Import(merge) MUST union op records by filename — never overwrite or delete
  existing records. Since filenames are content hashes, union *is* merge.
- Import path validation: only entries matching
  `ops/<slug>/<64-lowercase-hex>.json` are accepted.

### 10.8 Conformance

`mix keyverse.conformance` validates any `ops/` tree: filename shape, file
bytes hash = filename, record shape (`v`, `slug` match, `parents`, `lamport`,
non-empty `ops`), known primitives (unknown → warning), dangling parents
(warning), and fold-vs-snapshot divergence (warning — legal until the next
reconciliation). Fixture `expect.json` files MAY carry a `"fold"` map of
`{"<slug>": <clean state>}`; a conforming fold implementation MUST materialize
exactly that state from the fixture's records. Reference vector:
[protocol/fixtures/valid/with_ops](protocol/fixtures/valid/with_ops/).

### 10.9 Reserved

Checkpoints (compacting a folded prefix into one record) and tombstone GC are
deliberately unspecified in v1; until then the log is append-only forever.
Sync transport for records (push, relay) is a separate future layer — v1
transport is the filesystem and the export zip.
