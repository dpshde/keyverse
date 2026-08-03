# iOS TestFlight

Canonical long-form guide: **[../../docs/DEPLOY.md](../../docs/DEPLOY.md)** § Mobile.

## Quick path

```sh
cd mobile
source .asc/env.local    # ASC_APP_ID=6797574306 …
./scripts/testflight.sh  # archive → verify IPA CFBundleVersion → Internal Testers
```

### Never ship a mismatched build number (ITMS-90345 / 90189)

Apple rejected build “2” when the **binary still said build 1**:

- `ITMS-90345` — request said 2, `Info.plist` had `CFBundleVersion` **1**
- `ITMS-90189` — build **1** for `0.1.0` was already on ASC

**Cause:** `ios/keyverse/Info.plist` used a **hardcoded** `CFBundleVersion` string, so `xcodebuild CURRENT_PROJECT_VERSION=2` did not change the IPA.

**Correct:**

| Key | Value in `Info.plist` |
|-----|------------------------|
| `CFBundleVersion` | `$(CURRENT_PROJECT_VERSION)` |
| `CFBundleShortVersionString` | `$(MARKETING_VERSION)` |

`scripts/testflight.sh` now **fails before upload** if the IPA’s versions ≠ the resolved next build / marketing version.

## Files

| Path | Purpose |
|------|---------|
| `.asc/env.local` | App ID, version, group (gitignored) |
| `.asc/env.example` | Template |
| `.asc/export-options-app-store.plist` | App Store Connect export + team |
| `.asc/artifacts/` | Archives / IPAs (gitignored) |
| `scripts/testflight.sh` | Full pipeline |
| `scripts/asc-create-app.sh` | One-time ASC app create |

## Identity

- Bundle ID: `dev.dpslabs.keyverse`
- App ID: `6797574306`
- Version: set `ASC_VERSION` (default `0.1.0`); build number auto-increments

## Auth tools

```sh
asc doctor                 # API key
asc web auth login …       # only for web-only ASC actions
# Optional: pass-cli for Apple ID / secrets
```

## After upload

1. App Store Connect → TestFlight → build **VALID**
2. Internal Testers group includes the build
3. Install via TestFlight app on a device in the team
