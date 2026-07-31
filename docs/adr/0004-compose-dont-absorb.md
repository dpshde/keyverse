# 0004. Compose, don’t absorb (containment computed)

## Status

Accepted

## Context

A note on John 3:16 and a note on John 3:16–18 both matter. Folding verse notes into range notes (or the reverse) destroys independence and block identity. Stored parent/child links between notes would duplicate scripture structure and drift.

## Decision

**Containment is computed** from OSIS geometry, never stored as note hierarchy. Views *project* related notes:

- Range/chapter pages and reading view show contained notes.
- Editor “Within” lists contained addresses as an inbox (open the note; don’t embed a second editor).
- Editing one address must never rewrite another’s file or block ids.

## Consequences

- **Easier:** mental model matches the page of scripture; no reparent bugs; compose scales to chapter reading.
- **Harder:** “move this bullet to the range note” is a copy/transclude problem for later; cross-chapter ranges need careful geometry.
- **Implication:** UI may nest *display*, but storage stays one file per address.
