# 0020. Append-only op log with deterministic fold (protocol 0.3)

## Status

Accepted

## Context

The pack's unit of storage is one snapshot per address (`notes/<slug>.json`,
last-writer-wins whole-note). With one device that is exactly right. With two
clients on the same pack (mobile local pack mirrored to a door, or two devices
behind one door), whole-note LWW silently discards the losing device's edits —
divergence was structurally possible and unrecoverable.

ADR 0008/0009-era discussions reserved an "op log + deterministic block-level
merge" extension *under* the pack. Protocol review (2026-08) concluded the
protocol was implementable by second clients but that concurrent-edit loss was
the biggest real interop gap.

Constraints that shaped the design:

- **Portability** — must stay plain files in the pack; no database, no daemon.
- **Snapshot compatibility** — 0.2 clients that only read/write
  `notes/<slug>.json` must keep working unmodified.
- **Determinism over cleverness** — two clients holding the same set of
  records must materialize byte-identical state with no negotiation. No
  character-level CRDT; blocks are the merge unit (ADR 0003: blocks are
  already the product's atom).

## Decision

### Storage: one immutable record per file

```
ops/<slug>/<sha256>.json
```

- The file bytes are the **canonical JSON encoding** of the record (object keys
  sorted bytewise, arrays in order, no whitespace, integers only).
- The filename is the lowercase hex SHA-256 **of the file bytes**. Appending is
  creating a file; identical records dedupe; sync of any kind (rsync, zip
  import, future relay) is set union. `shasum -a 256` verifies a record.

### Record = DAG node

Each record carries `parents` (hashes of the records it causally follows — the
log frontier at write time) and a Lamport counter (`max(seen)+1`). Wall-clock
`at` is informational and MUST NOT affect ordering.

### Deterministic fold

State is a pure function of the *set* of records:

1. Linearize the DAG topologically; order concurrent records by
   `(lamport, hash)`.
2. Replay each record's primitive ops in order with **total** semantics — no
   op may fail (unknown block → no-op or tombstone; unknown anchor → append;
   duplicate insert → no-op; unknown op name → no-op for forward compat).
3. Deleted blocks become tombstones that keep their list position, so
   concurrent inserts anchored on a deleted block still land deterministically.
   Materialization strips tombstones and clamps indent to the +1-step rule.

Primitives (block granularity, whole-text LWW): `insert`, `set_text`,
`set_indent`, `set_collapsed`, `move`, `delete`, `put_attachment`,
`remove_attachment`.

### Snapshot stays canonical for simple clients

`notes/<slug>.json` remains the projection every 0.2-level client reads and
writes. Log-aware writers reconcile before appending: if the snapshot differs
from the current fold (an out-of-band edit by a snapshot-only client), they
synthesize an **implicit** record capturing that diff first, then append their
own edit. Divergence heals lazily; nothing is lost.

### Sealed notes are exempt

Encrypted notes (ADR 0012) stay whole-snapshot LWW. Logging plaintext ops for
sealed content would leak edit structure; the log for a slug freezes while it
is sealed and resumes from the fold on unseal.

### Export/import carries the log

`ops/` joins `notes/` and `attachments/` in the user-owned transfer set
(ADR 0015). Import(merge) unions records — which is exactly merge semantics.

### Explicitly out of scope for v1

Sync transport (relay, push), mobile-native op writing, checkpoint/GC of
tombstones, character-level merge, capability-scoped partial sync.

## Consequences

Easier:

- Two clients editing the same note while disconnected converge to the same
  state without a server, by file-set union.
- Any future sync transport reduces to "copy files both ways".
- Full edit history per note comes for free (records are timestamped).
- Second implementations can verify integrity with standard tools and prove
  fold correctness against conformance vectors
  (`protocol/fixtures/valid/with_ops`).

Harder / accepted costs:

- Log grows without bound until a future checkpoint/GC ADR (records are small
  JSON; acceptable for note-taking volumes).
- Writers that are log-aware must fold before writing (O(log size) per write).
- Concurrent whole-block text edits still lose one side's *wording* (block
  text is LWW); only structural convergence is guaranteed. Character CRDTs
  were rejected as disproportionate for outline notes.
- Snapshot-only clients continue to overwrite each other between
  reconciliations; the log bounds the loss to the un-reconciled window instead
  of eliminating it.

Protocol version bumps to `0.3` (additive; 0.2 and 0.1-demo packs remain
valid — `ops/` is optional). Normative text: PROTOCOL.md §10. Schema:
`schemas/op.schema.json`. Reference implementation: `Keyverse.CanonicalJson`,
`Keyverse.Fold`, `Keyverse.OpLog`.
