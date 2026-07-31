# Architecture Decision Records

We use [Michael Nygard’s ADR format](https://github.com/architecture-decision-record/architecture-decision-record) (Context / Decision / Consequences) to record durable choices for versepack.

| ADR | Title | Status |
|-----|--------|--------|
| [0001](./0001-pack-on-disk-is-source-of-truth.md) | Pack on disk is the source of truth | Accepted |
| [0002](./0002-osis-passage-addressing.md) | OSIS passage addressing | Accepted |
| [0003](./0003-flat-blocks-outline.md) | Flat line-blocks for outline content | Accepted |
| [0004](./0004-compose-dont-absorb.md) | Compose, don’t absorb (containment computed) | Accepted |
| [0005](./0005-frictionless-no-accounts.md) | Frictionless capture, no accounts | Accepted |
| [0006](./0006-reference-door-single-process.md) | Reference door: single Node process, no framework | Accepted |
| [0007](./0007-scripture-text-as-disposable-cache.md) | Scripture text is a disposable cache | Accepted |
| [0008](./0008-prod-layers-deferred.md) | Production layers deferred under the pack | Accepted |
| [0009](./0009-wiki-link-cross-references.md) | Wiki-link cross-references in block text | Accepted |
| [0010](./0010-attachments-files-and-urls.md) | Attachments: any file type and URLs | Accepted |
| [0011](./0011-multiword-door-access.md) | Multiword door URL is the access key (cowyo-style) | Accepted |
| [0012](./0012-client-side-note-encryption.md) | Client-side note encryption (cowyo-style passphrase) | Accepted |

## How to add an ADR

1. Copy the template below into `docs/adr/NNNN-short-title.md` (next free number).
2. Fill **Status**, **Context**, **Decision**, **Consequences**.
3. Link it from this table.
4. Prefer “Accepted” only after the code/docs match; use “Proposed” while debating.

### Template (Nygard)

```markdown
# NNNN. Title

## Status

Accepted | Proposed | Deprecated | Superseded by ADR-XXXX

## Context

What forces are at play?

## Decision

What did we choose?

## Consequences

What becomes easier or harder?
```

## Priority of product forces

When decisions conflict, apply this order (locked for the demo era):

1. **Frictionlessness** — think passage → type → write → autosaved; access = multiword URL  
2. **Portability** — pack is plain files; readable without the server  
3. **Permanence** — optional later (sync, Arweave, multi-device keys); never block capture  

Optional **client-side note encryption** (ADR 0012) is available now. It is a
confidentiality layer under frictionlessness, not a permanence/sync feature.

## Related ADRs (access & privacy)

| Concern | ADR |
|---------|-----|
| No accounts / no save button | 0005 |
| Multiword door URL | 0011 |
| Client-side pack passphrase | 0012 |
| Deferred multi-device / at-rest / blob crypto | 0008 |

## Doc map

| Need | Doc |
|------|-----|
| Run locally | [../SELF_HOST.md](../SELF_HOST.md), [../../README.md](../../README.md) |
| Deploy | [../PRODUCTION.md](../PRODUCTION.md) |
| UI how-to | [../USAGE.md](../USAGE.md) |
| Interop format | [../../PROTOCOL.md](../../PROTOCOL.md) |
