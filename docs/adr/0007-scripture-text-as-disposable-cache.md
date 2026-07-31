# 0007. Scripture text is a disposable cache

## Status

Accepted

## Context

Reading view needs chapter text, but scripture text is not the user’s intellectual property and must not be confused with notes. Offline reading is desirable after first fetch.

## Decision

BSB chapter text is **derived data**: fetched on demand (e.g. from bolls.life), stored under `pack/text/bsb/`, and **never treated as user data**. It is gitignored, may be deleted anytime, and is re-fetched when missing.

User truth remains only under `pack/notes/`.

## Consequences

- **Easier:** offline read after warm cache; pack backups can skip `text/`; licensing surface for notes is separate from translation files.
- **Harder:** first open needs network (or a pre-seeded cache); translation choice is fixed to BSB in the demo.
- **Implication:** never merge verse text into note JSON as the canonical store.
