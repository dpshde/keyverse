# 0006. Reference door: single Node process, no framework

## Status

Superseded by [0014](./0014-protocol-layers-pack-vs-door.md)

## Context

The protocol must not be buried under framework structure. A thin, readable server proves the pack and HTTP door. Dependency surface should stay small.

## Decision

~~Ship a **single ESM file** (`server.mjs`) on Node’s `http` module with one runtime dependency (`grab-bcv`). No Express/Fastify, no DB driver, no bundler required to run.~~

**Superseded:** The reference door is a **thin multipack HTTP host** whose
language is not normative. Production reference is currently **Elixir/OTP
(Bandit + Plug)** with a Mix release. `server.mjs` remains a legacy behavioral
reference only. Protocol SoT stays the pack on disk (ADR 0001, ADR 0014).

Env: `PORT`, `HOST`, `PACK_DIR`. One process assumes **single writer** per pack.

## Consequences

- **Easier (original):** read the whole door in one sitting; deploy is `node server.mjs`; protocol stays primary.
- **Now:** host may use a small framework/release; protocol conformance is offline.
- **Implication:** new features that force the pack to require a specific host language should be rejected.
