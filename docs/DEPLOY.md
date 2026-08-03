# Deploy & update

How to **ship** keyverse: production multipack **host** (Elixir / Railway) and **iOS TestFlight** (Expo / `asc`).

For product intent and coding conventions, see root [AGENTS.md](../AGENTS.md).  
For hardening detail, see [PRODUCTION.md](./PRODUCTION.md) and [SELF_HOST.md](./SELF_HOST.md).

---

## Surfaces

| Surface | What ships | Trigger |
|---------|------------|---------|
| **Host door** | OTP release on Railway | Push/merge to `main` (auto) |
| **Web client** | Static assets inside release (`priv/static`) | Same as host |
| **iOS app** | IPA → App Store Connect / TestFlight | Manual `asc` pipeline from `mobile/` |

There is **no** GitHub Actions deploy job for Railway; CI only validates (`mix test` + smoke).

---

## 1. Host (Elixir multipack door)

### Identity

- **Builder:** Railway **RAILPACK** (`railway.json`)
- **Start:** OTP release  
  `RELEASE_DISTRIBUTION=none /app/_build/prod/rel/keyverse/bin/keyverse start`
- **Health:** `GET /health` → JSON with `"host":"elixir"`, `"ok":true`
- **Data:** multipack root `PACK_DIR` (must be a **persistent volume**)

### Environment (production)

| Variable | Required | Notes |
|----------|----------|--------|
| `PORT` | yes | Railway injects |
| `HOST` | `0.0.0.0` | Listen all interfaces in container |
| `PACK_DIR` | yes | Absolute path on volume, e.g. `/data` |
| `DOOR_OPEN` | **unset** | Never `1` in production |
| `DOOR` / `PACK_DOOR` | optional | Seed pack key on boot |
| `MAX_ATTACH_BYTES` | optional | Default 50MiB |
| `CORS_ORIGIN` | optional | `*` default; lock down if needed |
| `MIX_ENV` | `prod` | Build-time on Railway |

### Update host (routine)

```sh
# From a clean branch with host changes
git push origin main
# Railway auto-deploys from main
```

Verify:

```sh
curl -sS https://YOUR-HOST/health | jq .
# expect: ok, host=elixir, protocol=keyverse
```

Optional: open a known door home `https://YOUR-HOST/{key}/` and confirm notes load.

### First-time / volume checklist

1. Attach a **volume** → mount at `PACK_DIR` (e.g. `/data`).
2. Set `PACK_DIR=/data`, `HOST=0.0.0.0`.
3. Confirm healthcheck path `/health` (see `railway.json`).
4. Backup plan: rsync `PACK_DIR` regularly ([PRODUCTION.md](./PRODUCTION.md#backups)).

### Host release locally (debug)

```sh
mix deps.get
MIX_ENV=prod mix release
PACK_DIR=./packs HOST=0.0.0.0 PORT=4180 \
  RELEASE_DISTRIBUTION=none \
  _build/prod/rel/keyverse/bin/keyverse start
```

### Web static changes with host

If you edit client CSS/JS in `server.mjs`:

```sh
node scripts/extract_client_js.mjs
# commit priv/static/* then deploy main
```

`priv/static` is what the release serves; extract keeps it in sync with `server.mjs`.

### CI

`.github/workflows/ci.yml` on PR/`main`:

- `mix test`
- Boot smoke (no full Railway deploy)

---

## 2. Mobile (iOS TestFlight)

### Identity (current)

| Field | Value |
|-------|--------|
| Bundle ID | `dev.dpslabs.keyverse` |
| App Store Connect app ID | `6797574306` (also in `mobile/.asc/env.local`) |
| Marketing version | `0.1.0` (bump in `app.json` + Xcode when shipping user-facing versions) |
| Scheme / workspace | `keyverse` / `ios/keyverse.xcworkspace` |
| Team (Xcode signing) | `467UZHSCC3` |
| Export method | `app-store-connect` · automatic signing |
| Default TF group | **Internal Testers** |
| Tools | [asc](https://github.com/rorkai/asc) CLI + Xcode |

### Prerequisites

```sh
asc doctor                    # API key profile OK
# Web session only needed for: first app create, some web-only flows
asc web auth status
```

Credentials (agents): Proton Pass / `pass-cli` often holds Apple ID + ASC API material. Prefer API key for upload; web login needs 2FA.

```sh
cd mobile
test -f .asc/env.local && source .asc/env.local
# Required: ASC_APP_ID
# Optional: ASC_VERSION, ASC_TESTFLIGHT_GROUP / ASC_TESTFLIGHT_GROUP_ID
```

Copy from `mobile/.asc/env.example` if needed. **Never commit** `env.local` or `artifacts/*.ipa`.

### One-time app create

```sh
cd mobile
asc web auth login --apple-id YOUR@EMAIL
# Select provider that owns the apps (e.g. Dylan Shade)
./scripts/asc-create-app.sh
# Writes .asc/env.local with ASC_APP_ID
```

Creates bundle ID if missing, ASC app record, free pricing (best-effort), Internal Testers group if you create it via API as in that script path.

### Routine TestFlight update (preferred)

After mobile code changes:

```sh
cd mobile
source .asc/env.local
./scripts/testflight.sh
```

This will:

1. Resolve next **build number** for `ASC_VERSION` (default `0.1.0`)
2. `asc xcode archive` (Release, generic iOS)
3. `asc xcode export` → IPA under `.asc/artifacts/`
4. `asc publish testflight` → wait for processing, add to **Internal Testers**, notify

### Manual publish (IPA already built)

```sh
cd mobile
source .asc/env.local

asc builds next-build-number --app "$ASC_APP_ID" --version "${ASC_VERSION:-0.1.0}" --platform IOS

# After archive/export to .asc/artifacts/keyverse-VERSION-BUILD.ipa:
asc publish testflight \
  --app "$ASC_APP_ID" \
  --ipa .asc/artifacts/keyverse-0.1.0-N.ipa \
  --version 0.1.0 \
  --build-number N \
  --group "Internal Testers" \
  --wait --notify \
  --test-notes "Describe what changed" \
  --locale en-US
```

Or upload then attach group:

```sh
asc builds upload --app "$ASC_APP_ID" --ipa PATH.ipa --version 0.1.0 --build-number N --wait
asc builds update --app "$ASC_APP_ID" --latest --uses-non-exempt-encryption=false
asc builds add-groups --app "$ASC_APP_ID" --latest --group "Internal Testers"
```

### Versioning

| Knob | Where | When to bump |
|------|--------|--------------|
| Marketing `CFBundleShortVersionString` | `mobile/app.json` `version`, Xcode `MARKETING_VERSION`, `ASC_VERSION` | User-facing release trains |
| Build `CFBundleVersion` | Auto via `next-build-number` / script | **Every** TF upload |
| Encryption | `ITSAppUsesNonExemptEncryption=false` in Info.plist / app.json | Keep false unless you ship non-exempt crypto |

### Sim vs store build

| Goal | Command |
|------|---------|
| Dev on simulator | `cd mobile && pnpm exec expo run:ios --device "iPhone 17 Pro"` |
| Device / TF | `./scripts/testflight.sh` (Release archive) |

Do **not** use detached `pnpx expo` for this app (breaks expo-router resolution). Use `pnpm exec expo` / project scripts.

### External TestFlight / App Store

Internal group: no Beta App Review.  
External group: `asc publish testflight ... --group "External" --submit --confirm` after compliance metadata is complete in ASC (privacy, screenshots as required).

Full App Store: `asc publish appstore` (separate from routine TF). See `asc docs show workflows`.

### Deep links (product)

Shared / inbound links default to **reader**:

- App: `keyverse:///read/{slug}`
- Cloud: `https://{host}/{door}/read/{slug}`

See `mobile/src/lib/deepLink.ts`, ADR 0019.

---

## 3. Decision tree

```text
Changed only Elixir / priv/static / PROTOCOL host behavior?
  → push main → Railway → curl /health

Changed only mobile/?
  → sim QA → ./scripts/testflight.sh (if shipping to devices)

Changed protocol used by both?
  → mix test + conformance → mobile client update → host deploy → TF if app must match door

Emergency host rollback?
  → Railway previous deploy / redeploy last known good commit on main
```

---

## 4. Troubleshooting

| Symptom | Check |
|---------|--------|
| Railway 502 / no elixir host | Logs, volume mount, `PACK_DIR`, release start command |
| Health ok but packs empty | Wrong volume path or wiped mount |
| TF upload rejects signing | Team ID, automatic provisioning, bundle ID match |
| `asc publish` needs `--group` | Create Internal Testers: `asc testflight groups create --app ID --name "Internal Testers" --internal` |
| ITMS **90345** Info.plist value mismatch | **IPA `CFBundleVersion` ≠ build number in the ASC request.** Usually Info.plist hardcoded `1` while script asked for `2`. Fix: plist must be `$(CURRENT_PROJECT_VERSION)`; `testflight.sh` verifies after export and aborts on mismatch. |
| ITMS **90189** Redundant Binary Upload | Same as above or re-upload of an already-accepted build number for that marketing version. Always use `asc builds next-build-number` and never re-upload build `N` after ASC accepted `N`. |
| Web login 2FA | `pass-cli` Apple item + fresh code; use correct **provider** (`asc web auth login` lists them) |
| Expo router / metro fail | Use `pnpm` project binary, not `pnpx expo` |
| `priv/static` out of date | Re-run `node scripts/extract_client_js.mjs` |

---

## 5. Checklist — “ship a mobile fix”

- [ ] Code on branch; sim smoke (home tree, reader note, empty-note rail)
- [ ] `cd mobile && source .asc/env.local && ./scripts/testflight.sh`
- [ ] ASC build **VALID**; Internal Testers has build
- [ ] Install from TestFlight; smoke again on device
- [ ] If host API changed: deploy `main` first and verify `/health` + one door call

## 6. Checklist — “ship a host fix”

- [ ] `mix test` (and conformance if pack/protocol)
- [ ] Extract static if `server.mjs` client changed
- [ ] Merge/push `main`
- [ ] Railway deploy green; `curl …/health`
- [ ] Spot-check `/setup` or known door; pack volume intact

---

## Related

- [AGENTS.md](../AGENTS.md) — agent conventions  
- [PRODUCTION.md](./PRODUCTION.md) — TLS, proxy, systemd, backups  
- [SELF_HOST.md](./SELF_HOST.md) — local install  
- [SCALING.md](./SCALING.md) — BEAM multipack rationale  
- [mobile/README.md](../mobile/README.md) — product client + short TF path  
- [adr/0019-passage-deep-link-sharing.md](./adr/0019-passage-deep-link-sharing.md)  
