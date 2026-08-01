# 0007. Scripture text is a disposable cache

## Status

Accepted (updated 2026-08-01: self-hosted BSB pack)

## Context

Reading view needs chapter text, but scripture text is not the user’s intellectual
property and must not be confused with notes. Offline reading must work without
a third-party API.

## Decision

1. **BSB is served from a pack inside the app:** `priv/bsb/chapters.json.gz`,
   built from the official public-domain text at
   https://bereanbible.com/bsb.txt (see `priv/bsb/NOTICE`).
2. At boot, chapters load into ETS. There is **no runtime network fetch**
   (no bolls.life / no other upstream).
3. Optional host disk files under `packs/_cache/text/bsb/` may still be read as
   a legacy fallback; they are **never** user data and are not exported.
4. User truth remains only under pack `notes/` (+ attachments).

Rebuild the pack with `scripts/build-bsb-pack.py` when the official text updates.

## Consequences

- **Easier:** reader works offline from first request; no outbound allowlist for
  scripture; cold chapter latency is local ETS, not WAN.
- **Harder:** release ships ~1.3 MB gzipped text; BSB updates need a pack rebuild
  + deploy.
- **Implication:** never merge verse text into note JSON as the canonical store.
