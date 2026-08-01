# 0014. Protocol layers: pack core vs door profiles

## Status

Accepted

## Context

keyverse is easy to misread as “the Elixir/Node app.” Protocol credibility
requires a hard split: durable pack rules vs optional access surfaces. Host
rewrites (Node → Elixir) must not redefine the protocol.

## Decision

1. **Pack core (normative):** addressing (OSIS/slug), on-disk layout,
   note/attachment/cipher JSON, `protocol.json`, ignore-unknown,
   single-writer assumption for v0.1-demo. Spec: `PROTOCOL.md` + `schemas/`.
2. **Conformance:** offline validation of pack directories (`protocol/fixtures`,
   `mix keyverse.conformance`). HTTP is not required to pass.
3. **Profiles (optional):**
   - **door-http** — `docs/API.md` matrix under `/{door}/…`
   - **ownership-transfer** — export/import zip (`docs/OWNERSHIP.md`)
   - **multipack-host** — `PACK_DIR/{key}/` layout + setup/enter UX
4. **Reference door:** any thin host that speaks profiles; language is not
   normative. Supersedes the “single Node file” implementation claim of ADR 0006.

## Consequences

- **Easier:** second clients target the pack; CI can gate protocol without
  booting Bandit; host churn does not fork the format.
- **Harder:** docs must keep profiles out of “MUST” core language; features
  that only work online need an explicit profile label.
- **Implication:** never require a running keyverse host to call a pack complete.
