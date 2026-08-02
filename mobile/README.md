# Tauri Mobile Native (ADR 0018)
#
# Architecture: thin native WebView shell → same Elixir multipack UI.
# Desktop browser UX is the source of truth; native only adds chrome/safe-area.
#
# Prerequisites
#   - Rust (rustup), Node 20+
#   - Elixir host running for dev (or let `npm run tauri:dev` start it)
#   - iOS: macOS + Xcode 15+ + CocoaPods
#   - Android: Android Studio + SDK 26+ + NDK
#
# First-time
#   npm install
#   npm run icons:tauri
#   # optional once per machine:
#   npm run tauri:ios:init      # generates src-tauri/gen/apple (gitignored)
#   npm run tauri:android:init  # generates src-tauri/gen/android (gitignored)
#
# Dev (desktop Tauri window against local mix)
#   npm run tauri:dev
#   # or: mix run --no-halt   # terminal A
#   #     npx tauri dev       # terminal B  (if you clear beforeDevCommand)
#
# Dev (device / emulator)
#   npm run tauri:ios:dev
#   npm run tauri:android:dev
#   # Point the shell at a reachable host:
#   #   production default is baked into mobile/shell/index.html
#   #   override: localStorage kv_native_host  or  ?host=https://…
#
# Release
#   npm run tauri:ios:build
#   npm run tauri:android:build
#
# UI rules
#   - Layout still driven by existing @media (max-width: 640px) desktop CSS.
#   - html.kv-tauri / kv-native-mobile only adjust safe-area, PWA install hide,
#     and glass dock bottom insets — they do not rewrite desktop wide layouts.
#   - Do not special-case features behind "is mobile" unless touch/safe-area
#     truly requires it; prefer the shared responsive styles.
#
# See docs/adr/0018-tauri-mobile-native.md and docs/MOBILE_NATIVE.md
