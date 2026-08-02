# Mobile native (Tauri v2)

keyverse’s **product UI is the web app**. Tauri is a packaging shell so the same
HTML/CSS/JS runs inside iOS/Android (and desktop) WebViews.

## Goals

- Ship App Store / Play builds without a second UI stack
- Keep **desktop browser** layout and interaction as-is
- Adapt **native mobile chrome** only: safe areas, status bar, no PWA install UI,
  glass docks above the home indicator

## Non-goals (phase 1)

- Reimplementing the Elixir door in Rust
- Offline pack CRDT / native SQLite SoT
- Replacing the installed PWA path for browser users

## Architecture

```
┌─────────────────────────────────────────┐
│  Tauri WebView (iOS / Android / desk)   │
│  ┌───────────────────────────────────┐  │
│  │  same keyverse UI (priv/static)   │  │
│  │  platform.js → html.kv-* classes  │  │
│  └───────────────────────────────────┘  │
│                   │ HTTPS / LAN           │
│                   ▼                       │
│         Elixir multipack door             │
│         packs/ on durable disk            │
└─────────────────────────────────────────┘
```

Dev desktop window talks to `http://127.0.0.1:4180` (local `mix`).  
Release mobile builds open `mobile/shell/index.html`, which probes a host
(default production Railway) then `location.replace`s into the live door UI.

Override host anytime:

```js
localStorage.setItem("kv_native_host", "https://your-host.example");
// or cold start: mobile/shell/index.html?host=https://…&door=your-four-word-key
```

## UI adaptation rules

| Concern | Approach |
|---------|----------|
| Breakpoints | Existing `@media (max-width: 640px)` — **do not** invent a second system |
| Touch targets | Existing `--tap` / `--tap-comfy` (44–48px) |
| Safe areas | Already on `body` + docks; `html.kv-native-mobile` reinforces |
| Desktop wide | `min-width: 641px` rules unchanged; `kv-tauri-desktop` does not force mobile |
| Nest vs chapter dock | Exclusive single bottom dock (already shipped) |
| PWA install button | Hidden when `html.kv-tauri` |
| Service worker | Not registered inside Tauri (`pwa-boot.js` early return) |

When adding UI: **write responsive CSS first**. Only add `html.kv-native-*`
overrides for true native chrome (insets, overscroll, status bar collision).

## Developer setup

### All platforms

```sh
# repo root
npm install
npm run icons:tauri
rustup update stable
```

### Desktop shell (Linux/macOS/Windows)

```sh
npm run tauri:dev          # starts mix if needed, opens WebView → :4180
npm run tauri:build        # packages desktop artifact
```

### iOS (macOS only)

```sh
xcode-select --install     # once
npm run tauri:ios:init     # once per clone — writes src-tauri/gen/apple
npm run tauri:ios:dev      # simulator or device
npm run tauri:ios:build
```

Set your Apple team in `src-tauri/tauri.conf.json` → `bundle.iOS.developmentTeam`
or in the generated Xcode project.

### Android

```sh
# ANDROID_HOME + NDK installed (Android Studio)
npm run tauri:android:init
npm run tauri:android:dev
npm run tauri:android:build
```

`minSdkVersion` is **26** (Android 8) per Tauri v2 defaults in config.

## Files

| Path | Role |
|------|------|
| `src-tauri/` | Rust host, `tauri.conf.json`, icons, capabilities |
| `mobile/shell/` | Packaged splash → host hop |
| `priv/static/platform.js` | Early platform flags |
| `priv/static/app.css` | `html.kv-*` native chrome block (end of file) |
| `docs/adr/0018-tauri-mobile-native.md` | Decision record |

## Verification checklist

- [ ] Desktop browser @ 1280px: layout identical to pre-Tauri
- [ ] Mobile browser @ 390px: docks, nest/nav exclusive, home tree unchanged
- [ ] `tauri dev` desktop window: app loads door UI; no PWA install chip
- [ ] iOS sim: safe-area clear of home indicator; reader dock tappable
- [ ] Android emu: edge-to-edge; back gesture doesn’t break history unexpectedly
- [ ] Production host override works from shell query param

## Roadmap

1. Deep links into `/{door}/read/…`
2. Optional biometric app lock (local only)
3. Native share sheet for door QR / invite
4. Evaluate OPFS/local pack mount via plugin (parity with `/local`)
