# keyverse mobile (React Native / Expo)

**Local-first product client.** Scripture + notes work offline. Cloud is an optional multiword mirror.

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

### Passage share (cloud)

When cloud is on, **Share** on note and reader headers builds a **projected**
deep link: `https://{host}/{door}/read/{slug}` (verse, range, or chapter).
Same trust model as web: the URL includes the multiword door. See
[ADR 0019](../docs/adr/0019-passage-deep-link-sharing.md) and
`src/lib/shareUrl.ts`.

### Thumb-reach (mobile-first)

Primary actions stay in the **lower third / bottom dock**, not top-only desktop chrome:

- **Passage search** is a floating **liquid-glass** capsule (`PassageSelector`: frosted fill, specular rim, soft field well — pure RN, no `expo-blur`).
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

## Layout

```
mobile/
  assets/text/bsb|kjv/   bundled chapters.json.gz
  assets/words-door.txt  multiword door lexicon
  src/lib/textBundle.ts  gunzip + chapter get
  src/lib/localPack.ts   local SoT
  src/lib/cloudSync.ts   door claim + double
  src/lib/resolveLocal.ts
```
