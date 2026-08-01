# 0003. Flat line-blocks for outline content

## Status

Accepted

## Context

Users want sibling and nested notes without learning indent syntax, but we also need stable identity for future merge/transclusion. Nested JSON trees are awkward to edit and merge; a single textarea with space-indent is hostile on mobile and easy to corrupt.

## Decision

Note content is a **flat ordered list** of line-blocks `{ id, indent, text, … }`. The outline tree is a **projection** of `indent`, never stored nested.

- UI: outliner (Enter / Nest / Unnest / collapse / move / …); no required formatting language.
- Interchange: 2-space indent text for curl/`?raw` (text-only fields).
- IDs: client may send stable `b_*` ids; text PUT uses LCS line matching as a demo stand-in for op-log identity.
- Optional UI fields (e.g. `collapsed`) may ride on the JSON block; see [ADR 0013](./0013-outline-collapse-and-structural-ops.md).

Blank bullets are first-class. A note is deleted only when **all** blocks lack text.

## Consequences

- **Easier:** simple merge hooks by block id; plain interchange; one model for verse/range/chapter notes.
- **Harder:** rich inline formatting is out of band; deep trees rely on client indent validation; full CRDT not provided in demo.
- **Implication:** future op log should emit add/edit/move/remove by block id, not whole-document replace only.
