# 0009. Wiki-link cross-references in block text

## Status

Accepted

## Context

Notes need to point at other passages without a second identity system. Graph
databases and separate link tables add protocol surface and fail when the server
is dead. Users already know `[[wiki]]` links from common note tools.

## Decision

Cross-references live **in block `text`** as wiki links:

- `[[passage]]` or `[[passage|label]]`
- Target resolved with the same normalizer as addressing (OSIS/slug)
- Navigation opens that address’s note door (empty OK)
- No required stored backlink index in v0.1

The reference UI renders wiki links in read-only outlines and leaves raw
`[[…]]` in the outliner while editing.

## Consequences

- **Easier:** pack stays plain JSON; links survive offline and tool changes; one
  address space for notes and refs.
- **Harder:** rename/canon shifts need text scan; rich preview of targets is a
  client concern; typo targets are soft-fail until resolved.
- **Implication:** never require a separate `links.json` for basic cross-refs.
