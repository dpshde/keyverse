# versepack protocol v0.1-demo

versepack is a *pack format*, not an app. The protocol is: how notes are
addressed, how they are laid out on disk, and what a record contains. Anything
that reads and writes a conforming pack directory is a versepack client — the
bundled server is just the reference client (a door). Two clients pointed at
the same pack interoperate with no coordination beyond the filesystem.

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

```
pack/
  protocol.json          {"protocol": "versepack", "version": "0.1-demo"}
  notes/<slug>.json      one record per addressed note
  text/                  derived scripture-text cache; disposable, never user data
```

- The pack MUST remain fully readable with no server running: plain JSON,
  UTF-8, pretty-printed, newline-terminated.
- Deleting a note = deleting its file. An empty body write MUST delete.
- `text/` MAY be deleted at any time; clients re-fetch on demand.

## 3. Note record

```json
{
  "id": "note_…",
  "scope": { "kind": "verse", "osis": "JHN.3.16", "slug": "jhn.3.16" },
  "blocks": [ { "id": "b_…", "indent": 0, "text": "…" } ],
  "created_at": "ISO-8601",
  "updated_at": "ISO-8601"
}
```

Legacy records may carry `body` (a flat string) instead of `blocks`; clients
MUST hydrate `body` into blocks on read (one block per line, indent = leading
spaces / 2) and SHOULD write `blocks` on next save.

## 4. Blocks (miniature outline)

A note's content is a flat, ordered list of line-blocks. The outline tree is a
projection of `indent`; it is never stored nested.

- `id`: stable across edits. A client editing text MUST preserve the ids of
  surviving lines (the reference client uses LCS line matching). Ids are the
  hook for merge, transclusion, and the future op log.
- `indent`: non-negative integer, at most one deeper than the previous block
  when projected.
- `text`: one line, markdown-ish, no newlines.
- Interchange form: `"  ".repeat(indent) + text` joined by `\n`. Parsing and
  serializing MUST round-trip.

## 5. Containment (compose, don't absorb)

Scripture geometry is computed, never stored. A scope maps to an interval on
the book's (chapter, verse) line; chapter scopes span the whole chapter.
Given two scopes in one book: `contains`, `within`, `overlaps`, or disjoint.

Clients SHOULD use containment to *project* related notes into a view (a range
page shows the verse notes inside it; a chapter reading view interleaves them
verse by verse). Clients MUST NOT copy, merge, or reparent records to achieve
this: every note keeps its own address, file, and block ids.

## 6. HTTP door (optional)

A serving client SHOULD expose:

- `GET /api/notes` — every record in the pack.
- `GET /api/note/<slug>` — one record; `?raw` returns the block interchange
  form as `text/plain`.
- `PUT /api/note/<slug>` — body is either raw interchange text (`text/plain`)
  or `{"blocks":[...]}` (`application/json`). Empty / all-blank deletes.
  Response is the stored record (or `{deleted:true}`).

## 7. Reserved extensions (not in v0.1)

Op log + deterministic block-level merge, content-addressed attachments,
envelope encryption, PAKE device pairing, relay sync, Arweave permanence.
These layer *under* the pack (the pack becomes a materialization); the formats
above are designed so none of them change the reading surface.
