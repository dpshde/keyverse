# Scaling the multipack host

keyverse’s product is a **pack format** plus an optional **HTTP door**. The
pack does not need a special runtime: any language that can read and write a
folder is a client. Scaling pressure shows up almost only in the **shared
multipack host** — one process (or cluster) that maps many multiword keys to
many pack directories and serves browsers and APIs.

This note compares that host shape on **Node** (today’s reference door) with
**BEAM** (Erlang / Elixir) and other languages. It is not a commitment to
rewrite; it is a map of *where* a rewrite would help and where it would not.

## What we are scaling

| Layer | Scales with… | Language-sensitive? |
|-------|----------------|---------------------|
| Pack on disk | Disk, backup, single-writer discipline | No |
| Browser outliner / PWA | Client CPU, cache | No (stays JS) |
| Multipack HTTP door | Concurrent connections, packs, IO, ops | **Yes** |
| Future sync / presence | Per-pack coordination | **Yes** |

Today’s reference model:

```text
clients  →  one Node process  →  PACK_DIR/{key}/notes|attachments
```

Many keys, one OS process, shared event loop. That is fine for personal hosts
and early multipack demos. It is not the natural ceiling for a busy public
host or for soft multi-device features later.

## Where Node is already enough

- **Pack protocol** — JSON files, CAS blobs, OSIS slugs. Unchanged by host language.
- **Single writer per pack** — Correctness is filesystem discipline, not the runtime.
- **Small / medium load** — Debounced PUTs, occasional chapter fetches, light API traffic.
- **Self-host** — One `node server.mjs` + durable volume is simple to reason about.
- **Shipping the product** — The outliner, crypto bar, and door UX are browser JS either way.

If pain is product UX or pack design, rewrite the host language does nothing.

## Where a single Node door starts to creak

### 1. One event loop for every pack

Node is excellent at concurrent *waiting*, but CPU work and large body
handling still share one main thread (plus a small libuv pool for some disk
ops). A heavy attach upload, a fat `GET /api/notes` scan, or a pathological
request can delay **unrelated** packs on the same process.

At multipack scale the failure mode is **noisy neighbor**: pack A’s traffic
affects pack B’s latency even though their directories are isolated on disk.

### 2. Isolation is by convention, not by process

`PACK_DIR/{key}/` isolates **data**. It does not isolate **runtime**: memory
leaks, uncaught exceptions, and global state are process-wide. One bad path
can take down every key on the host.

### 3. “Many idle tabs” is not free forever

Each open PWA / long-lived connection holds sockets and buffers. Node handles
tens of thousands of connections in the abstract, but a door that also
renders large HTML shells, scans many note files, and serves multi‑MB
attachments will hit memory and GC before pure connection count does.

### 4. Future features fight the process model

ADR 0008 deferred op-log merge, relay sync, multi-device envelopes. Those want:

- a unit of concurrency **per pack** (or per session),
- fan-out of “note updated” to a few watchers,
- supervised restart of one pack’s logic without rebooting the host.

You *can* build that on Node (worker threads, separate processes, Redis
pub/sub). You are then reimplementing pieces of what other runtimes give you
as defaults.

### 5. Ops story for “always-on multipack”

Node deploys are fine (systemd, Railway, containers). For long-lived hosts
that must stay up while you roll code, BEAM’s supervision and release culture
is a different default; Node’s is “replace the process.” Neither is wrong;
they optimize different operational tastes.

## How BEAM (Erlang / Elixir) matches this product

The multipack door is closer to **many small servers behind one URL space**
than to a single CRUD app. BEAM was built for that shape (telephony: many
calls, isolation, soft real-time).

### Pack ≈ process (or small supervision tree)

```text
/{key}/…  →  resolve key  →  PackServer (GenServer)
                              │
                              ├─ serialize writes for that pack
                              ├─ cache hot note list if needed
                              └─ PubSub topic: pack:{key}
```

- **Fault isolation:** a crash in pack A’s handler is supervised and restarted;
  other packs keep serving.
- **Write serialization:** one process owns writes for a pack — maps cleanly
  to “single writer per pack” without a global lock.
- **Backpressure:** mailboxes and timeouts are first-class; you can shed load
  per pack instead of stalling the whole host.

Node can approximate this with a `Map` of queues or worker threads. BEAM makes
it the default programming model.

### Cheap concurrency for idle clients

Millions of lightweight processes (not OS threads) are normal on BEAM. Idle
note tabs, presence, and future websocket sync sit naturally as processes or
Phoenix Channels, without a separate Redis-shaped nervous system on day one.

### Phoenix is a strong “door” framework

If the host is rewritten, **Phoenix** (Elixir) is the usual choice:

| Concern | Fit |
|---------|-----|
| Multipack routing | Plug pipeline: parse door → assign pack → handlers |
| HTML door pages | Controllers or HEEx; **or** keep serving today’s exact HTML/JS strings |
| JSON API | Same `/api/*` matrix as [API.md](./API.md) |
| Static / PWA | Plug.Static for `public/` |
| Live later | Channels / LiveView *optional*; not required to preserve current UI |
| Deploy | Releases, Observatory-friendly ops, Fly/BEAM culture |

Important: **the frontend does not need to become LiveView.** The scaling win
is the host. Keeping the existing outliner (exact JS/CSS) as static or
server-rendered HTML shells is a valid, lower-risk path.

### What BEAM does *not* magically fix

- Slow disks, huge attachments, or scanning thousands of JSON files per request
  still need design (indexes, pagination, caching) — any language.
- Multi-writer merge is still undefined in the protocol until an op-log exists.
- Client-side encryption stays in the browser; the host still only sees cipher
  envelopes.
- A BEAM host is another binary and toolchain for self-hosters who today only
  need Node.

## Other languages (brief)

| Runtime | Strength for this host | Tradeoff |
|---------|------------------------|----------|
| **Go** | Simple static binary, strong HTTP + concurrency (goroutines), easy deploy | Less “per-pack supervision” culture; you design isolation yourself |
| **Rust** (Axum/Actix) | Throughput, memory safety, fine control of IO | Higher implementation cost; less productive for HTML door churn |
| **Java / Kotlin** (Netty, Ktor) | Mature ops, thread pools, virtual threads (JDK 21+) | Heavier footprint; less aligned with tiny self-host demos |
| **Node cluster / PM2 / multiple processes** | Scale out *without* rewrite: one process per N packs or per CPU | More moving parts; still no free per-pack supervision |

**Go** is the most common “Node alternative” when the goal is a small,
fast multipack binary and ops simplicity. **BEAM** wins when the goal is
**many isolated packs + long-lived connections + later sync** under one
supervisor tree. **Rust** wins when raw efficiency and safety matter more
than rewrite speed.

None of them replace the pack protocol. They only replace `server.mjs`.

## Scaling without changing language first

Do these before a rewrite; they apply everywhere:

1. **Pagination** on `GET /api/notes` (and avoid full-pack HTML lists for huge packs).
2. **Per-pack write queue** (serialize PUTs/POSTs for a key in-process) — **done in Elixir** (`Keyverse.Pack.Writer`).
3. **Caps** on attach size (already), pack count, and request body times.
4. **Shared scripture cache** (already under `_cache/`) — never fan-out BSB
   fetches per pack.
5. **Horizontal split** by key hash if needed: reverse proxy → several
   workers, each with a shard of `PACK_DIR` or a shared volume with
   sticky routing by door segment.
6. **Don’t block** on large directory walks; stream or index.

If these keep the host healthy, invest in product over another rewrite.

## Decision guide

| Situation | Prefer |
|-----------|--------|
| Self-host / household / early multipack | **Elixir** reference door (or Node legacy) |
| Protocol and second clients | **Pack on disk + HTTP matrix** (language-agnostic) |
| Public multipack, many idle clients, planned presence/sync | **BEAM** host + per-pack writers (now) / Phoenix later |
| Want one static binary, low drama deploys, no BEAM shop | **Go** host |
| Max throughput / constrained metal | **Rust** host |
| Need scale *now* without rewrite | **Shard processes** + proxy sticky by `{door}` |

## Medium-traffic posture (current Elixir door)

Built for a **spike of real users** without instant disk death — not for
consumer-scale DAU.

| Control | Default | Env |
|---------|---------|-----|
| File size | 50 MB | `MAX_ATTACH_BYTES` |
| Attachments / note | 80 | `MAX_ATTACH_PER_NOTE` |
| **Pack attach bytes** | **1 GB** | `MAX_PACK_ATTACH_BYTES` |
| **Pack attach count** | **2000** | `MAX_PACK_ATTACH_COUNT` |
| Import zip | 200 MB | `MAX_IMPORT_BYTES` |
| Attach rate / door | 60 / min | (code default) |
| Note PUT / door | 180 / min | |
| Import / door | 6 / hour | |
| Setup (create door) / IP | 20 / hour | |
| Global writes | 600 / min | |

Responses: **429** + `Retry-After` when rate limited; **507** + `quota` when pack storage full.  
`GET /{door}/api/pack` includes `quota`. `/health` metrics include `rate_limited_count`, `quota_reject_count`, `limits`.

**Capacity intent:** dozens–low hundreds of light users; text-first packs scale further; media-heavy packs hit the 1 GB/door budget before the 5 GB volume does.

If traffic stays high: raise volume, lower per-pack budgets, add blob storage, sticky multi-replica (see below).

## Multi-replica on Railway (or any shared volume)

**Current production:** one replica, one volume (`PACK_DIR=/data`).

| Goal | Required |
|------|----------|
| 2+ replicas, same volume | **Sticky routing by door path** (`/{door}/…` → same instance) **or** split `PACK_DIR` shards |
| No sticky | **Do not** multi-replica — two writers can corrupt the same note file |
| Attachments at scale | Object store / larger volume; export zips grow with CAS |
| Observe load | `GET /metrics` (p50/p95 per op, user_data_bytes, writer count) |

Per-pack write queues serialize writers **inside one VM**. They do not coordinate across VMs.

## Boundary that must not move

Whatever serves HTTP:

- One multiword key → one pack directory.
- API and page routes stay under `/{door}/…` (unless `DOOR_OPEN`).
- Pack remains readable with the server dead.
- Frontend capture UX can stay the current browser code; the host is a door,
  not the source of truth.

The pack is the product. The runtime only has to **not get in the way** of
many doors on one machine — and, later, of sync layered *under* the pack
([ADR 0008](./adr/0008-prod-layers-deferred.md)).

## Summary

Node is a good **legacy reference door**: fast to ship, enough for single-writer
multipack at moderate load. BEAM is a better **shape** for a serious multipack
host because isolation, supervision, and per-pack concurrency match “many
keys, many libraries, one origin.” Go and Rust are solid alternatives when
deploy binary and efficiency dominate over OTP-style design.

Rewrite the host when host pain is real. Do not rewrite for aesthetics, and
do not couple a host rewrite to a frontend rewrite — the outliner can stay
exactly as it is.
