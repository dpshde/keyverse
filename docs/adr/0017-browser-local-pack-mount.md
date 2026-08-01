# 0017. Browser local pack mount (directory as door)

## Status

Proposed — **Phase 1 (read-only) implemented** (2026-08-01)

## Context

Pack-on-disk is already the product (ADR 0001). Ownership transfer via zip is
shipped (ADR 0015). Operators can point a host at a folder with `PACK_DIR`.

What is missing: a **browser session** that uses a directory on the user’s
machine as the live pack — no multipack host, no zip round-trip for day-to-day
editing — while keeping the same UI (outliner, home tree, crypto bar).

Motivation:

- Frictionless local-first: “open my notes folder” like Obsidian vault open
- Proves second-client story without a second app binary
- Complements zip (zip = leave/move hosts; mount = work where the files live)

## Decision (proposed)

### Layer placement

| Layer | Change? |
|-------|---------|
| **Pack core** | **None.** Same layout, note JSON, CAS attachments, seal rules. |
| **Conformance** | Reuse; run in-browser (subset) after open + after import-from-zip into dir. |
| **New profile: `local-fs-door`** | Optional client profile. Not HTTP. Not multipack host. |
| **ownership-transfer (zip)** | Unchanged; remains portable unit across machines/browsers. |
| **door-http / Elixir host** | Unchanged default for shared/multi-device URL access. |

`local-fs-door` is a **client runtime profile**, parallel to `door-http`:

```text
                    ┌─────────────────────────┐
  UI (outliner…) ──►│  PackStore interface    │
                    └───────────┬─────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
       HttpPackStore     LocalFsPackStore    (future: native)
       (today BASE/api)  (directory handle)
              │                 │
              ▼                 ▼
         host PACK_DIR      user folder
```

**Normative rule:** anything `LocalFsPackStore` writes MUST pass the same
filesystem MUST checks as host writers (slug = filename stem, CAS present,
cipher shape, indent step). Prefer shared JS conformance or a small WASM/CLI
later — do not invent a softer browser schema.

### Product surface (UX)

| Entry | Behavior |
|-------|----------|
| Home / setup | **Open local pack…** (Chromium / supporting browsers) |
| First open | `showDirectoryPicker({ mode: 'readwrite' })` |
| Empty dir | Offer **Initialize pack** → write `protocol.json` (+ optional `door` file for portability) |
| Non-empty non-pack | Refuse or offer “create pack subfolder” — never clobber unknown trees |
| Existing pack | Validate lightly → enter home tree (same HTML app shell) |
| Permission lost | Banner: re-grant directory access; no silent data loss |
| Persist handle | `navigator.storage.getDirectory` is *not* the pack; use IndexedDB to store the **FileSystemHandle** (Chrome) + label; re-query permission on load |
| Coexistence | “Use hosted door” remains; mount mode is explicit session choice |

Copy framing:

- Mount = **work on files in place**
- Export zip = **carry a snapshot**
- Hosted door = **URL share / always-on multipack**

Do **not** call mount “sync.” Single-writer still applies (ADR 0008 deferred).

### PackStore API surface (client)

Introduce a thin async interface used by outliner / editor / home / attachments.
Today those call `fetch(BASE + "/api/…")` directly — that is the seam to break.

```ts
// Conceptual — not committed types
type NoteSlug = string;

interface PackStore {
  readonly kind: "http" | "local-fs";
  readonly label: string;           // door phrase or folder name
  getProtocol(): Promise<ProtocolInfo>;
  listNotes(): Promise<NoteMeta[]>; // enough for home tree
  getNote(slug: NoteSlug): Promise<NoteRecord | null>;
  putNote(slug: NoteSlug, record: NoteRecord): Promise<void>;
  deleteNote(slug: NoteSlug): Promise<void>;
  getAttachment(sha256: string): Promise<Blob | null>;
  putAttachment(bytes: Blob): Promise<{ sha256: string; bytes: number }>;
  deleteAttachment?(sha256: string): Promise<void>;
  exportZip?(): Promise<Blob>;      // optional; local can zip via JS or omit
  // resolve/suggest stay pure client (grab-bcv / existing JS) — not store IO
}
```

**LocalFsPackStore** mapping:

| Method | FS ops |
|--------|--------|
| `getNote` | read `notes/<slug>.json` |
| `putNote` | write temp → rename (best-effort atomic); create `notes/` |
| `deleteNote` | unlink note file; GC unreferenced attachments when safe |
| `putAttachment` | SHA-256 in JS → write `attachments/<hex>` if absent |
| `getAttachment` | read blob by hex name |
| `listNotes` | iterate `notes/*.json` (metadata only if perf requires) |
| init | write `protocol.json` `{protocol,version}` matching shipped version |

**HttpPackStore** = thin wrapper over existing door matrix (no behavior change).

Scripture text: keep using host `/api/text/…` **or** a public CDN/cache when in
local-fs mode. Text is disposable (ADR 0007) — local mount MUST NOT require
embedding BSB in the pack. Options for v1:

1. **Hybrid (recommended):** notes local; scripture fetch from configured HTTP
   origin (keyverse host or static text service) with offline fallback empty.
2. Pure offline: optional later `text/` cache writer in-browser.

### Browser matrix

| Browser | Directory picker + persistent R/W handle | Mount v1? |
|---------|------------------------------------------|-----------|
| Chromium desktop (Chrome/Edge/Brave) | Yes — File System Access API | **Ship target** |
| Chrome Android | Partial / limited; picker exists, persistence weaker | Defer or read-mostly |
| Safari desktop | No full FSA directory write (as of spike date) | **Fallback:** zip import/export + guided “download folder” is not mount |
| Firefox | No standard FSA write directory | Same fallback |
| iOS any | No usable local pack mount | Zip / hosted door only |
| Tauri/Electron/PWA wrapper later | Full FS via native bridge | Future `native-fs` store |

Detection:

```js
const canMount =
  typeof window.showDirectoryPicker === "function";
```

UI: show **Open local pack** only when `canMount`; otherwise keep zip + door.

Permissions:

- Must request `readwrite` for editing.
- On return visit: `handle.queryPermission` → `requestPermission` if not granted.
- User clearing site data drops stored handles — treat as “unmounted.”

### vs zip (do not collapse)

| | **Zip transfer** | **Local mount** |
|--|------------------|-----------------|
| Unit | Snapshot archive | Live directory |
| When | Backup, migrate host, share offline blob | Daily edit where files already live |
| Writer | Host `PackTransfer` or CLI | Browser `LocalFsPackStore` |
| Multi-device | Carry zip | Separate copies; still single-writer per copy |
| Safari/Firefox | Works | Not available |
| Server | Optional | Not required for note IO |
| Conformance gate | After import | After open (warn) + before “Export zip from mount” |

Mount **can** offer “Download zip” by client-side zipping user paths (same include
list as OWNERSHIP.md) without a host — nice, not required for MVP.

### Non-goals (v1)

- Multi-tab multi-writer CRDT / op-log (still ADR 0008)
- Multipack browser tree (one mounted pack per session)
- Transparent sync between mounted folder and Railway door
- Using OPFS (`navigator.storage.getDirectory`) as the *user-visible* pack
  (OPFS may cache handles/metadata only — user’s SoT stays the picked folder)
- Replacing self-host `PACK_DIR` for operators
- Safari polyfill that fakes a directory with thousands of download prompts

### Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Partial writes / crash mid-save | Write `notes/.<slug>.tmp` then `move`; serialize puts per pack (in-tab queue) |
| Origin eviction / lost handle | Clear UX to re-pick folder; never claim cloud backup |
| User opens wrong folder | Detect `protocol.json`; refuse foreign trees |
| Large attachment SHA in main thread | `crypto.subtle.digest` async; optional worker later |
| SW/cache serving stale app while writing live FS | SW must not cache note JSON; only static assets |
| Dual-write confusion (HTTP + local) | Session is one PackStore; badge in chrome: “Local folder” vs “Door …” |
| Conformance drift (JS vs Elixir) | Shared fixture pack in CI; browser tests against `protocol/fixtures` |
| Security: page XSS ⇒ filesystem write | Existing XSS surface becomes higher severity; tighten CSP, no open HTML in notes |

### Implementation phases

**Phase 0 — seam (partial)**  
`LocalFsPackStore` lives in `priv/static/pack-store.js`. Hosted editor still uses
direct `fetch(BASE + "/api/…")` (HttpPackStore extraction deferred).

**Phase 1 — read-only mount (Chromium) — DONE**  
- Route: `GET /local` (`Html.render_local_mount/0`)
- Client: `pack-store.js` + `local-mount.js`
- Entry: enter page link + directory picker
- E2E: `npm run test:e2e:local-mount` (Playwright seeds OPFS fixture, same handle API)
- Router tests: `test/keyverse/local_mount_router_test.exs`

**Phase 2 — read-write mount**  
put/delete notes + attachments; init empty pack; in-tab write queue; status
line “saved to folder”. Hybrid scripture from HTTP origin.

**Phase 3 — polish**  
Stored handle resume, “Export zip from folder”, lightweight conformance banner,
docs: OWNERSHIP.md + USAGE + new profile blurb in PROTOCOL layers table +
`GET /api/protocol` feature flag only when *serving* the SPA (static), not a
server capability.

**Phase 4 — optional native shell**  
If Safari/iOS matter: thin Tauri/Aside wrapper implementing same PackStore.

### Doc / ADR follow-through when building

1. Accept this ADR (or supersede with narrowed MVP).  
2. PROTOCOL.md layers table: add **local-fs-door** profile (non-normative).  
3. OWNERSHIP.md: “Live folder (browser mount)” row next to zip/CLI/folder copy.  
4. USAGE.md: Chromium-only open flow.  
5. Feature detect in home HTML next to Export/Import.

### Success criteria

- Edit a note in Chromium with **no keyverse server running**; reload; note file
  on disk matches outliner (pretty JSON, canonical slug filename).  
- Same folder opened later via `PACK_DIR=… mix run` or zip import shows the note.  
- `mix keyverse.conformance` on that folder passes.  
- Safari users still have zip + hosted door; no broken empty button.

## Consequences

- **Easier:** true local-first without abandoning pack protocol; strongest demo
  that “the folder is the product.”  
- **Harder:** PackStore abstraction across generated client JS; browser matrix
  communication; XSS impact radius.  
- **Implication:** zip stays mandatory for portability; mount is Chromium-class
  power-user path, not the universal default.

## Related

- ADR 0001 pack SoT · 0005 no accounts · 0007 disposable text · 0008 deferred sync  
- ADR 0014 layers · 0015 zip transfer · 0012 client-side seal  
- `docs/OWNERSHIP.md`, `PROTOCOL.md`, `lib/keyverse/pack_transfer.ex`
