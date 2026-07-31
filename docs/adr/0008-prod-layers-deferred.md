# 0008. Production layers deferred under the pack

## Status

Accepted

## Context

Op-log merge, multi-device key exchange, device pairing, relay sync, and
permanent storage are real needs for multi-device permanence—but implementing
them in the capture door would slow the demo and risk warping the pack format
around incomplete sync.

Some “privacy” layers *have* landed without blocking capture:

- Multiword door access (ADR 0011)
- Optional client-side note passphrase encryption (ADR 0012)

Those are capture/access concerns, not the deferred permanence stack below.

## Decision

**Deliberately omit** from v0.1-demo permanence / multi-device work:

- Op log + deterministic block-level merge
- Multi-device envelope key exchange / shared sealed packs across devices
- Server-side encryption at rest (disk/volume crypto is the operator’s job)
- Full attachment-blob encryption (CAS bytes sealed, not only metadata)
- PAKE device pairing
- Dumb relay sync / resumable transfer
- Optional Arweave (or similar) permanence

**In scope already:**

| Layer | ADR |
|-------|-----|
| Content-addressed file + URL attachments | 0010 |
| Multiword door URL access | 0011 |
| Client-side per-note / pack-passphrase seal | 0012 |

Remaining permanence layers MUST sit **under** the pack (pack becomes a
materialization). They MUST NOT change addressing, block shape, or the
no-account capture surface. See PROTOCOL.md reserved extensions.

## Consequences

- **Easier:** demo stays small and honest; pack format freezes around capture +
  compose; privacy options (door + optional passphrase) exist without sync.
- **Harder:** multi-device users must copy the pack or accept single-writer until
  those layers exist; sealed notes need the same client envelope on every
  device; operators who need disk-level crypto use OS/volume tools.
- **Implication:** new work that only serves sync / multi-device keys should land
  as separate modules/clients, not as a rewrite of `notes/<slug>.json` identity.
