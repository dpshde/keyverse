# versepack (demo)

A cowyo-class capture door over an on-disk scripture note pack.

- **Address = passage.** `/note/jhn.3.16` (verse), `/note/jhn.3.16-18` (range), `/note/1jn.1` (chapter). Type "John 3:16" in the box on `/` and you're there.
- **Open → type → saved.** Autofocus editor, 400ms-debounce autosave, no save button, no account.
- **The folder is the truth.** Every note is plain JSON in `pack/notes/<slug>.json`. Kill the server; the pack is still complete and readable. The server is just a door.
- **Every note is a miniature outline.** Content is a flat list of line-blocks `{id, indent, text}` (dotflowy-style: flat rows canonical, tree derived from indent). The editor is an outliner: **Enter** new item, **Tab** nest, **Shift-Tab** unnest — no indent syntax to learn. Block ids survive edits, so blocks stay addressable for future merge/transclusion. (curl still uses the 2-space text interchange form.)
- **Broader passages compose, never absorb.** Open `/note/jhn.3.16-18` and your independent note on `jhn.3.16` renders beneath it under "Within John 3:16-18" — projected there by canonical containment (computed from OSIS geometry, never stored). Editing the range note can't touch the verse note; each keeps its own address, file, and block ids. The verse page links back to the broader note ("Part of broader notes").

Try it: open `/note/jhn.3` — both seeded notes compose into the chapter view.

## Run

```sh
pnpm install
pnpm dev        # http://localhost:4180
```

## curl in / curl out

```sh
# write a note from stdin
echo "Nicodemus came at night." | curl -X PUT --data-binary @- localhost:4180/api/note/jhn.3.16

# read it back as markdown
curl localhost:4180/api/note/jhn.3.16?raw

# full JSON record
curl localhost:4180/api/note/jhn.3.16

# everything in the pack
curl localhost:4180/api/notes
```

Saving an empty body clears the address (cowyo-style).

## What this demo fakes

Single writer, no encryption, no op log, no attachments, no sync. Those live
in the versepack protocol (op log + CAS + deterministic merge + envelope
crypto + PAKE device pairing + optional Arweave permanence); this demo proves
the capture physics, the pack-on-disk claim, and compose-don't-absorb.

The block ids are the protocol hook: in prod, edits become block-level ops
(add/edit/move/remove by id), which merge across devices without a full CRDT.
The LCS id-matching here is the demo stand-in for a real op-emitting editor.
