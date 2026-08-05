# keyverse mobile (React Native / Expo)

**Local-first product client.** Scripture + notes work offline. Cloud is an optional multiword mirror.

## TestFlight (via `asc`)

**Full operator guide:** [../docs/DEPLOY.md](../docs/DEPLOY.md) · short path: [docs/TESTFLIGHT.md](./docs/TESTFLIGHT.md) · agents: [../AGENTS.md](../AGENTS.md)

Prerequisites: `asc doctor` OK, Xcode, `mobile/.asc/env.local` with `ASC_APP_ID`.

```bash
cd mobile
source .asc/env.local
./scripts/testflight.sh          # archive → IPA → Internal Testers + notify
```

One-time app create (if needed):

```bash
asc web auth login --apple-id YOUR@EMAIL
./scripts/asc-create-app.sh      # writes .asc/env.local
```

Bundle ID `dev.dpslabs.keyverse` · App ID `6797574306` · export: `.asc/export-options-app-store.plist`

## Defaults

| Concern | Default |
|---------|---------|
| Notes / attachments | **On-device pack** (`documentDirectory/keyverse/pack/`) |
| Scripture | **Bundled BSB + KJV** (`assets/text/*/chapters.json.gz`) |
| Cloud | **Off** until Settings toggle |
| Cloud on | Claims multiword door, **doubles local → host** (+ pull) |

## Bundled text

- **BSB** — same pack as server `priv/bsb` (public domain)
- **KJV** — `priv/kjv` + `mobile/assets/text/kjv` (public domain)

Rebuild KJV: `python3 scripts/build-kjv-pack.py /path/to/kjv.txt priv/kjv`

## Pack import / export (RN)

Same **user-data zip** as the web door (`PackTransfer`):

```
protocol.json
door                 # optional
notes/<slug>.json
attachments/<sha256>
```

| Action | Where |
|--------|--------|
| Export local → zip share sheet | Settings / Pack |
| Import zip merge | Settings / Pack |
| Import zip replace | Settings / Pack |
| Pull cloud `GET /api/pack/export` → local | Settings (cloud on) |
| Push local zip → `POST /api/pack/import` | Settings (cloud on) |

Implementation: `src/lib/packTransfer.ts` (fflate). Scripture bundles are never included.


## Screens

| Route | Role |
|-------|------|
| `/home` | Local notes tree, offline resolve/suggest, passphrase |
| `/read/[slug]` | VBV reader from bundled BSB/KJV + local outlines |
| `/note/[slug]` | Outliner + local attachments + encrypt |
| `/settings` | Translation · cloud toggle · sync |
| `/share` | Sync key management (pack door), not per-passage links |

### Passage share + deep links (reader default)

**Share** on note and reader headers always targets the **projected reader**
(ADR 0019 — verse, range, or chapter):

| Mode | URL |
|------|-----|
| Local / app | `keyverse:///read/{slug}` |
| Cloud on | `https://{host}/{door}/read/{slug}` (+ door-scoped app link) |

**Inbound:** `DeepLinkHandler` opens cold-start and live links into `/read/[slug]`
(or `/note/[slug]`). Door-scoped https/app URLs join that multiword pack when needed.

See [ADR 0019](../docs/adr/0019-passage-deep-link-sharing.md), `src/lib/deepLink.ts`,
`src/lib/shareUrl.ts`.

### Thumb-reach (mobile-first)

Primary actions stay in the **lower third / bottom dock**, not top-only desktop chrome:

- **Passage search** is a floating **liquid-glass** capsule (`PassageSelector` / `LiquidGlassShell`: `expo-blur` + light wash + top rim, shared with reader dock).
- Suggestions stack as a glass sheet **above** the capsule in the thumb zone.
- Secondary chrome (pack status, passphrase, Settings/Share) can live at the top.

### Button system (`src/theme.ts` → `ui.*`)

Use only these — no ad-hoc blue text “buttons”:

| Style | Use |
|-------|-----|
| `ui.primaryBtn` | One main action (Go, Save, Sync, Export) |
| `ui.secondaryBtn` | Alternate (Import, Open reader) |
| `ui.ghostBtn` / `ui.ghostBtnSm` | Chrome actions (Settings, Share, Prev/Next) |
| `ui.headerBtn` | Nav bar trailing actions |
| `ui.link` | In-content links only (markdown), not chrome |

## Run (pnpm)

This app targets **Expo SDK 54** — the SDK currently shipping in **App Store Expo Go** (as of 2026-08, store Go is still 54; SDKs 55–57 need `eas go` / TestFlight Expo Go or a dev build).

```sh
cd mobile
pnpm install
pnpm start
# or: pnpm start:clear
# or: pnpm exec expo start --clear
```

From repo root: `pnpm --dir mobile start` / `pnpm mobile` (after `pnpm --dir mobile install`).

**Do not use `pnpx expo`.** `pnpx` / `pnpm dlx` install a detached Expo CLI that cannot resolve this app’s `expo-router` (fails with `Cannot find module 'expo-router/_ctx-shared'`). Always use the project binary via `pnpm start` or `pnpm exec expo`.

| Command | Use |
|---------|-----|
| `pnpm install` | Install deps (lockfile: `pnpm-lock.yaml`) |
| `pnpm start` | Metro + Expo Go QR |
| `pnpm exec expo …` | Any Expo CLI flag against **local** deps |
| `pnpx expo …` | Avoid — isolated CLI, breaks this project |

`mobile/.npmrc` sets `node-linker=hoisted` so Expo/Metro resolve modules correctly under pnpm.

## Cloud mirror + note deletes

Cloud is optional. When on, quiet full sync (launch / foreground / Settings)
**unions** local and door. Deletes must not come back as “zombie notes.”

**Rule (ADR 0021):** local delete wins until the door is confirmed empty for
that slug.

| Step | Behavior |
|------|----------|
| Local delete | Unlink `notes/{slug}.json`, drop from index + memory, mark **pending cloud delete** |
| Immediate mirror | Empty PUT `{blocks:[],attachments:[]}` → host `{deleted:true}`; clear pending on success |
| Full sync | Flush pending deletes → push only **still-live** notes → flush pending again → pull (skip pending) |
| Editors | Honor delete events even when dirty; no unmount/autosave rewrite of a deleted slug |

```
deleteNote(slug)
  → pendingDeletes += slug
  → file/index/cache gone
  → mirrorNoteIfCloud → empty PUT (or keep pending on failure)

quietSync / enableCloudAndSync (serialized)
  → flushPendingCloudDeletes
  → for each listed note: re-check live + !pending, then PUT
  → flushPendingCloudDeletes   # undoes mid-sync delete races
  → pull remote, bulkUpsert skips pending
```

**Do not:**

- Push from a one-shot `listNotes()` snapshot without re-checking each slug
- Clear pending before the door empty-PUT succeeded (except intentional recreate)
- Let a dirty tray/full note ignore `deleted` and flush old blocks on unmount

**Debug a zombie:** `GET /{door}/api/note/{slug}` — if 200 after local delete,
something re-pushed (this device race or another client). Empty PUT should leave
GET 404. See [ADR 0021](../docs/adr/0021-local-delete-wins-cloud-mirror.md).

## Layout

```
mobile/
  assets/text/bsb|kjv/   bundled chapters.json.gz
  assets/words-door.txt  multiword door lexicon
  src/lib/textBundle.ts  gunzip + chapter get
  src/lib/localPack.ts   local SoT (+ pending deletes)
  src/lib/cloudSync.ts   door claim + double (delete-safe sync)
  src/lib/resolveLocal.ts
```
