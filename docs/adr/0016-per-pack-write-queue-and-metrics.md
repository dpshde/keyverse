# 0016. Per-pack write queue and host metrics

## Status

Accepted

## Context

Concurrent PUTs to the same pack can interleave filesystem writes. BEAM’s
advantage is isolation by process; a single Plug router does not automatically
serialize per-pack IO. Operators also need latency/volume signals without a
full APM stack.

## Decision

1. **Per-pack GenServer** (`Keyverse.Pack.Writer`) serializes mutating IO for
   one pack directory (note put/delete, attachment blob write, pack import).
2. Writers are started on demand via `DynamicSupervisor` + `Registry`, idle-stop
   after 5 minutes.
3. **Metrics** (`Keyverse.Metrics`) keep ETS counters and rolling latency
   samples; expose `GET /metrics` and a summary under `GET /health`.
4. Multi-replica remains **unsupported without sticky routing by door** (shared
   volume + single-writer assumption). Documented in SCALING.md.

## Consequences

- **Easier:** no torn note JSON under concurrent clients on one pack; basic p95
  visible in production.
- **Harder:** nested `Writer.call` from inside a writer deadlocks (callers must
  use locked internals); many packs ⇒ many processes (mitigated by idle stop).
- **Implication:** horizontal scale requires sticky door → replica or external
  object storage before multi-writer.
