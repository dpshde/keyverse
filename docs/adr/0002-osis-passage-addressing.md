# 0002. OSIS passage addressing

## Status

Accepted

## Context

Notes need stable, shared addresses that match how people talk about scripture. Free-text titles create identity chaos and block compose-by-geometry. Human input is messy (“jn 3:16”, “1 John 1”).

## Decision

Every note is addressed by a **canonical OSIS scope** (verse, same-chapter range, or chapter). The **slug** is lowercased OSIS and is both the filename and the URL path segment.

Human strings are normalized via `grab-bcv` before addressing. Sloppy URLs 302 to the canonical slug. `/go?q=` accepts anything human.

One address ⇒ at most one note.

## Consequences

- **Easier:** URLs are shareable and meaningful; containment is computable from geometry; curl paths are obvious.
- **Harder:** non-scripture “topic” notes are out of scope (deliberately); cross-chapter ranges are limited in v0.1; renames of canon rules would require migration.
- **Implication:** identity is the passage, not a user-chosen title.
- **Sharing:** deep links under the door use these slugs; default share is the projected reader (`/read/{slug}`). See [ADR 0019](./0019-passage-deep-link-sharing.md).
