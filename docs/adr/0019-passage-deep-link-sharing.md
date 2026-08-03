# 0019. Passage deep-link sharing (verse / range / chapter)

## Status

Accepted

## Context

Notes are already addressed by canonical OSIS scope (ADR 0002): verse
(`jhn.3.16`), same-chapter range (`jhn.3.16-18`), or chapter (`jhn.3`). The
door already serves:

| Surface | Path | Role |
|---------|------|------|
| Editor | `/{door}/note/{slug}` | Exact note at that address |
| Reader | `/{door}/read/{slug}` | Scripture + **projected** notes (ADR 0004) |
| Resolve | `/{door}/go?q=` | Human ref → note or read |

Pack-level share already exists: multiword door home + QR (`GET /api/share-qr`).
Knowing the door is access to the whole pack (ADR 0005, 0011).

Users also want to hand someone a link to **one passage** (verse, range, or
chapter). Two product models compete:

1. **Deep link under the door** — reuse OSIS URLs; recipient who has the link
   has the door secret.
2. **Capability token** — opaque `/s/{id}` (or scoped secondary door),
   read-only, revocable, does not leak the multiword key.

We also need a default for *what view* a “share this passage” action opens:
exact note only vs projected reading view (chapter text + contained notes).

## Decision

### v1: deep links only (no capability tokens)

Share a passage by copying a URL under the existing multiword door. No new pack
identity, no share-token storage, no pack-core protocol change.

### Default share target: projected reader

| Action | URL | Recipient sees |
|--------|-----|----------------|
| **Share / Copy link** (default) | `/{door}/read/{slug}` | BSB chapter + notes whose geometry falls in that scope (compose, don’t absorb) |
| Editor link (secondary / optional) | `/{door}/note/{slug}` | Outline for that address only |
| Pack collab | `/{door}/` | Full home / write access (existing door share) |

Scope kinds map to slugs the same way as note files:

| Kind | Example OSIS | Share URL |
|------|--------------|-----------|
| verse | `JHN.3.16` | `/{door}/read/jhn.3.16` |
| range | `JHN.3.16-18` | `/{door}/read/jhn.3.16-18` |
| chapter | `JHN.3` | `/{door}/read/jhn.3` |

### QR may encode a deep path

`GET /api/share-qr?origin=<origin>&path=<optional>`:

- Default `path` = pack home (`/{door}/`).
- Allowed deep paths: `/note/<slug>`, `/read/<slug>` (validated; no `..`, no
  absolute URLs).
- Invalid path → `400`.

Door-host UX helper only — not pack core (ADR 0014).

### Clients

- **Web:** Share control on note editor and reader; `navigator.share` or
  clipboard; default URL is reader.
- **Mobile:** system share sheet when cloud sync is on
  (`https://{host}/{door}/read/{slug}`); local-only packs prompt to enable sync
  (no hostless public link).

### Explicitly not chosen in v1

- Opaque share tokens (`/s/{id}`) with `exact` | `project` modes.
- Read-only secondary multiword doors scoped to a passage.
- Snapshot freeze at share time (links always reflect live pack head).
- Public directory / SEO of shares.

Capability-safe sharing remains a reserved door-host extension if we later need
to share outside the trust circle without revealing the pack key.

## Consequences

- **Easier:** zero new identity system; URLs stay human-meaningful; reader
  projection reuses existing `/read` and `build_read_bundle` / containment;
  mobile and web share the same URL shape; curl and bookmarks work.
- **Harder:** a shared passage link **is** full-pack access (read and write
  under current door model). Sealed notes still need the client passphrase
  (ADR 0012), but unrelated plaintext notes are reachable via the door.
- **Implication:** product copy must say “link includes your key.” Prefer
  pack-level door rotation (ADR 0011) if a deep link leaks, not per-note
  revocation (there is none in v1).
- **Layering:** addressing and projection stay pack-core; share buttons and
  path-aware QR are door-host + client UX.

## References

- ADR 0002 — OSIS passage addressing  
- ADR 0004 — Compose, don’t absorb  
- ADR 0005 — Frictionless, no accounts  
- ADR 0011 — Multiword door  
- ADR 0012 — Client-side note encryption  
- ADR 0014 — Pack core vs door profiles  
- [USAGE.md — Passage deep links](../USAGE.md#passage-deep-links)  
- [API.md — share-qr](../API.md)  
- [PROTOCOL.md §7](../../PROTOCOL.md)  
