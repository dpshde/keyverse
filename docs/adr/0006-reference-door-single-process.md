# 0006. Reference door: single Node process, no framework

## Status

Accepted

## Context

The protocol must not be buried under framework structure. A thin, readable server proves the pack and HTTP door. Dependency surface should stay small.

## Decision

Ship a **single ESM file** (`server.mjs`) on Node’s `http` module with one runtime dependency (`grab-bcv`). No Express/Fastify, no DB driver, no bundler required to run.

Env: `PORT`, `HOST`, `PACK_DIR`. One process assumes **single writer** per pack.

## Consequences

- **Easier:** read the whole door in one sitting; deploy is `node server.mjs`; protocol stays primary.
- **Harder:** no built-in middleware ecosystem; production TLS/auth must be external; horizontal scale-out not designed.
- **Implication:** new features that force a framework should be rejected unless the pack protocol remains independently usable.
