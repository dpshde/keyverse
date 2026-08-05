# AGENTS.md — keyverse

Instructions for coding agents working in this repository.

## Product model (do not invert)

| Priority | Meaning |
|----------|---------|
| **Frictionlessness** | No accounts. Multiword door = pack access. Open → type → saved. |
| **Portability** | Pack on disk is the product; plain JSON + CAS attachments. |
| **Permanence** | Notes survive host rewrites; export/import zip is first-class. |

**Mobile is the product client** (Expo RN, local-first). **Web is the anywhere mirror** (Elixir door + `priv/static`). Pack protocol stays pack-core; share buttons and QR are door-host UX.

| Surface | Role | Source of truth for notes |
|---------|------|---------------------------|
| `mobile/` | Daily capture (local pack + bundled BSB/KJV) | On-device pack; cloud optional |
| Elixir door | Multipack host / sync mirror | `PACK_DIR/{key}/` on disk |
| Web `priv/static` | Browser client on the door | Same pack as host |

Do **not** redesign browser capture as LiveView or replace pack-on-disk with a blob-only store without an ADR.

## Repo map

```text
lib/keyverse/           Elixir multipack door (Bandit + Plug, OTP release)
priv/static/            Web CSS/JS/PWA (often generated from server.mjs extract)
priv/bsb|kjv/           Scripture chapter packs (public domain)
mobile/                 Expo SDK 54 / RN product app
  app/                  expo-router screens
  src/                  api, lib, components, theme
  ios/                  prebuild native project (commit if present)
  scripts/              TestFlight helpers (asc)
  .asc/                 export options, env.local (gitignored secrets)
packs/                  runtime multipack root (local; not the product binary)
docs/                   API, deploy, ADRs, usage
PROTOCOL.md             Normative pack + door protocol
schemas/                JSON Schema
server.mjs              Legacy Node door + CSS/JS template source for extract
scripts/extract_client_js.mjs  → priv/static (re-run after editing server.mjs CSS/JS)
```

## Non‑negotiables

1. **Pack format** — OSIS slug notes, flat outline `blocks[]`, CAS attachments. See `PROTOCOL.md`.
2. **Compose, don’t absorb** — reader projection; never merge note bodies across addresses (ADR 0004).
3. **Door vs pack** — multiword path is access (ADR 0011); client passphrase seals note text (ADR 0012).
4. **Passage share v1** — default URL is `/{door}/read/{slug}` (ADR 0019). Link includes the key (full pack access). No opaque share tokens unless a new ADR.
5. **Web static pipeline** — JS client scripts: prefer `server.mjs` templates then `node scripts/extract_client_js.mjs`. **`app.css` + `pwa-head.html` live in `priv/static`** (theme tokens, dual mode); extract skips them unless `EXTRACT_CSS=1`.
6. **Tests gate** — `mix test` and `mix keyverse.conformance` for protocol-facing changes.
7. **Mobile local-first** — default notes path is device pack; cloud is optional mirror (Settings / Share).

## Commands agents should know

### Elixir host (local)

```sh
mix deps.get
mix test
mix keyverse.conformance
mix run --no-halt                    # http://localhost:4180
# prod-ish:
MIX_ENV=prod mix release
MIX_ENV=prod mix run --no-halt
```

### Web static extract

```sh
node scripts/extract_client_js.mjs   # writes priv/static JS (skips app.css / pwa-head)
# EXTRACT_CSS=1 node scripts/extract_client_js.mjs   # also overwrite CSS from server.mjs (legacy)
```

### Mobile (sim)

```sh
cd mobile
pnpm install                         # packageManager: pnpm
pnpm exec expo run:ios --device "iPhone 17 Pro"
# Prefer project expo binary (not pnpx expo) — see mobile/README.md
```

### Mobile TestFlight (`asc`)

```sh
cd mobile
source .asc/env.local                # ASC_APP_ID, etc. (gitignored)
./scripts/testflight.sh              # archive → verify IPA → publish Internal Testers
```

**Never again (ITMS-90345 / 90189):**

| Mistake | What Apple sees |
|---------|-----------------|
| Hardcoded `CFBundleVersion` `1` in `ios/keyverse/Info.plist` while declaring build `2` to ASC | **90345** mismatch + **90189** redundant build 1 |
| Passing `--build-number` that differs from the IPA’s real plist | Same |
| Re-uploading without incrementing build for the same marketing version | **90189** |

**Rules:**

1. `Info.plist` **must** use `$(CURRENT_PROJECT_VERSION)` and `$(MARKETING_VERSION)` — not literal `1` / `0.1.0`.
2. Archive with `CURRENT_PROJECT_VERSION=<next>` from `asc builds next-build-number`.
3. **Unzip the IPA and read `CFBundleVersion` before upload**; abort if ≠ next. `testflight.sh` does this.
4. ASC request `--version` / `--build-number` must match the IPA exactly.

Full host + mobile deploy: **[docs/DEPLOY.md](docs/DEPLOY.md)**.

## Architecture touchpoints

| Concern | Where |
|---------|--------|
| HTTP routes / multipack | `lib/keyverse/router.ex` |
| Pack I/O, notes, transfer | `lib/keyverse/pack*.ex`, `note.ex` |
| Reader projection / OSIS | `lib/keyverse/scope.ex`, `tree.ex`, `html.ex` |
| Mobile local pack | `mobile/src/lib/localPack.ts` |
| Mobile cloud mirror | `mobile/src/lib/cloudSync.ts` |
| Local delete vs quietSync (no zombies) | ADR 0021; pending deletes in `localPack`; live push + double flush in `cloudSync` |
| Deep links (app + https door) | `mobile/src/lib/deepLink.ts`, `DeepLinkHandler.tsx` |
| Reader UI / selection | `mobile/app/read/[slug].tsx` |
| Outliner Enter / rails | `mobile/src/components/Outliner.tsx` |
| Visual tokens (mobile) | `mobile/src/theme.ts` (align with web paper/ink) |

## Change playbooks

### Protocol or door API

1. Update `PROTOCOL.md` / ADR if behavior changes.
2. Implement Elixir + tests + fixtures.
3. Update mobile client if the door profile is used (`mobile/src/api/`).
4. Keep `docs/API.md` matrix honest.

### Web UX only

1. Prefer `server.mjs` client **JS** → extract; edit **CSS/theme in `priv/static/app.css`**.
2. Match mobile product intent when both surfaces share a flow (share, reader, appearance).
3. No LiveView redesign of capture.

### Mobile product UX

1. Prefer local pack paths; cloud is optional.
2. Reuse `theme.ts` button/token system (no ad-hoc blue chrome).
3. Reader has-note rail must track live pack state (`notesBySlug` / `resolvedBlocks`), not load-time snapshots.
4. **Deletes must stick** (ADR 0021): mark pending cloud delete, empty-PUT the door, never re-push from a stale sync snapshot or dirty editor unmount. QuietSync flushes pending before **and** after the push loop.
5. After native-relevant changes, ship TestFlight via `docs/DEPLOY.md` § Mobile.

### Host deploy (Railway)

1. Push/merge `main` → Railway auto-deploy (RAILPACK release).
2. Ensure volume for `PACK_DIR`; never `DOOR_OPEN=1` in prod.
3. Health: `GET /health` → `host: elixir`.

## Secrets & tooling

| Tool | Use |
|------|-----|
| `asc` | App Store Connect / TestFlight (`asc doctor`, `publish testflight`) |
| `pass-cli` | Proton Pass for Apple ID / API keys when automating web login |
| Railway | Production multipack host |
| Do not commit | `mobile/.asc/env.local`, `.asc/artifacts/*.ipa`, API `.p8` keys |

## Docs map

| Doc | Audience |
|-----|----------|
| [docs/DEPLOY.md](docs/DEPLOY.md) | **Update/deploy host + TestFlight** (operators + agents) |
| [docs/PRODUCTION.md](docs/PRODUCTION.md) | Host production hardening |
| [docs/SELF_HOST.md](docs/SELF_HOST.md) | Local / LAN install |
| [docs/API.md](docs/API.md) | HTTP contract |
| [PROTOCOL.md](PROTOCOL.md) | Pack + door normative |
| [docs/adr/](docs/adr/) | Decisions (read before inventing alternatives) |
| [mobile/README.md](mobile/README.md) | Mobile product + TF quick path |
| [llms.txt](llms.txt) | Compact machine index |

## PR / commit hygiene

- Prefer focused diffs; no drive-by refactors.
- Do not commit packs user data, IPA artifacts, or `env.local`.
- Mention protocol/ADR impact in commit body when relevant.
- Run `mix test` (and conformance if pack/protocol touched) before claiming green.

## What “done” looks like

| Change type | Done when |
|-------------|-----------|
| Door bugfix | `mix test` green; prod `/health` if deploy claimed |
| Protocol change | ADR + PROTOCOL + fixtures/tests + client if needed |
| Mobile UX | Works offline; TF build only if user asked to ship |
| Deploy | Documented command path succeeded; IDs/versions recorded |

When unsure: **pack on disk wins**, mobile local-first wins, and share links that include the door are full-pack access by design (ADR 0019).
