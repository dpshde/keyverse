# ADR 0018 — Tauri v2 mobile (and desktop) native shell

Status: **Accepted** (scaffold)  
Date: 2026-08-02

## Context

keyverse is a server-rendered multipack note door (Elixir + static JS/CSS) with
a strong **mobile web** UI already (glass docks, 44px targets, safe-area,
exclusive nest/nav dock). We want App Store / Play distribution and a
home-screen-native feel **without forking the product UI** into a separate
React Native / Flutter codebase.

## Decision

Ship a **thin Tauri v2 shell** (`src-tauri/`, `mobile/shell/`) that hosts the
**same** web UI:

| Surface | Behavior |
|---------|----------|
| Desktop browser | Unchanged — source of truth for layout & features |
| Mobile browser / PWA | Existing responsive CSS + SW (unchanged) |
| Tauri desktop | WebView → local `mix` in dev; optional packaged shell → remote host |
| Tauri iOS / Android | WebView → configured host; platform.js adds safe-area / chrome classes only |

### Principles

1. **One UI codebase** — `priv/static/*` + `lib/keyverse/html.ex`. No parallel “native screens.”
2. **Progressive enhancement** — `platform.js` sets `html.kv-tauri`, `kv-native-mobile`, etc. CSS under those selectors only adjusts chrome (safe-area, hide PWA install, dock insets).
3. **Desktop UX preserved** — Wide windows keep desktop rules (`min-width: 641px`). Native must not force mobile layout on desktop Tauri.
4. **Server remains SoT for packs** — Phase 1 does not reimplement pack storage in Rust. Remote door URL (or LAN `mix`) is the API. Local RO mount stays a Chromium/browser feature until a later native FS plugin phase.
5. **PWA still first-class** — Tauri does not replace the service worker path for browser users; native builds simply skip SW registration / install prompts.

## Consequences

### Positive

- Single design system; mobile polish already in CSS carries into the store apps.
- Small Rust surface area (launcher + plugins).
- Can ship Android from Linux CI; iOS still needs a Mac for Xcode.

### Negative / deferred

- Offline-first pack sync is **not** in the shell yet (use existing SW + network).
- iOS/Android project trees (`src-tauri/gen/*`) are generated locally and gitignored — document `tauri ios/android init` for each developer machine.
- Deep links (`keyverse://door/...`) and push notifications are follow-ups.
- Store review requires privacy policy / account-less capture narrative (multiword door).

## Implementation map

```
src-tauri/           Tauri v2 app (Rust)
  tauri.conf.json    devUrl → local mix; frontendDist → mobile/shell
  capabilities/      IPC allowlist
mobile/
  shell/index.html   Production splash → probes host → location.replace
  README.md          Dev commands
priv/static/
  platform.js        Early class flags (kv-tauri, kv-native-mobile, …)
  app.css            html.kv-* native chrome only
  pwa-boot.js        No-op SW/install inside Tauri
docs/MOBILE_NATIVE.md
```

## Follow-ups (not blocking scaffold)

1. `tauri-plugin-deep-link` for `https://…/door` and custom scheme.
2. Status bar / edge-to-edge Android theme alignment with `theme-color`.
3. Optional biometrics gate before opening a door URL (client-side only).
4. Native file picker plugin if local pack mount is required outside Chromium.
5. CI: Android debug APK on Linux; iOS archive on macOS runner.

## References

- https://v2.tauri.app/
- Existing mobile web: reader docks, exclusive nest/nav dock, home tree
- ADR 0011 multiword doors · ADR 0012 client encryption · ADR 0017 local mount
