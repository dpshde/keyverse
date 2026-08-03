#!/usr/bin/env bash
# Archive → export IPA → verify CFBundleVersion → upload TestFlight.
#
# CRITICAL (ITMS-90345 / ITMS-90189):
#   The IPA's Info.plist CFBundleVersion MUST equal the build number we declare
#   to App Store Connect. Never pass --build-number that differs from the binary.
#   Info.plist must use $(CURRENT_PROJECT_VERSION) / $(MARKETING_VERSION), not
#   hardcoded "1" / "0.1.0". This script verifies after export and aborts on mismatch.
#
# Prerequisites:
#   - asc doctor OK
#   - App exists in App Store Connect (see scripts/asc-create-app.sh)
#   - ASC_APP_ID set (or pass --app)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .asc/env.local ]]; then
  # shellcheck disable=SC1091
  source .asc/env.local
fi

APP_ID="${ASC_APP_ID:-${1:-}}"
VERSION="${ASC_VERSION:-0.1.0}"
SCHEME="${ASC_SCHEME:-keyverse}"
WORKSPACE="${ASC_WORKSPACE:-ios/keyverse.xcworkspace}"
EXPORT_OPTS="${ASC_EXPORT_OPTIONS:-.asc/export-options-app-store.plist}"
GROUP="${ASC_TESTFLIGHT_GROUP_ID:-${ASC_TESTFLIGHT_GROUP:-Internal Testers}}"
TEAM="${ASC_TEAM_ID:-467UZHSCC3}"
INFO_PLIST="${ASC_INFO_PLIST:-ios/keyverse/Info.plist}"

if [[ -z "$APP_ID" ]]; then
  echo "ASC_APP_ID is required (or pass app id as first arg)." >&2
  echo "Create the app first:  ./scripts/asc-create-app.sh" >&2
  echo "Then:  export ASC_APP_ID=... && ./scripts/testflight.sh" >&2
  exit 1
fi

mkdir -p .asc/artifacts

# --- Guard: Info.plist must expand Xcode version vars (not hardcoded build 1) ---
if [[ -f "$INFO_PLIST" ]]; then
  CB_VER=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$INFO_PLIST" 2>/dev/null || true)
  CB_SHORT=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$INFO_PLIST" 2>/dev/null || true)
  if [[ "$CB_VER" != '$(CURRENT_PROJECT_VERSION)' ]]; then
    echo "FATAL: $INFO_PLIST CFBundleVersion is '$CB_VER'" >&2
    echo "       Must be \$(CURRENT_PROJECT_VERSION) so archive build numbers apply." >&2
    echo "       (Hardcoded values caused ITMS-90345: plist 1 vs request 2.)" >&2
    exit 1
  fi
  if [[ "$CB_SHORT" != '$(MARKETING_VERSION)' ]]; then
    echo "FATAL: $INFO_PLIST CFBundleShortVersionString is '$CB_SHORT'" >&2
    echo "       Must be \$(MARKETING_VERSION)." >&2
    exit 1
  fi
fi

echo "==> Resolve next build number for marketing version $VERSION"
BUILD_JSON=$(asc builds next-build-number \
  --app "$APP_ID" \
  --version "$VERSION" \
  --platform IOS \
  --initial-build-number 1 \
  --output json)
BUILD_NUMBER=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["nextBuildNumber"])' <<<"$BUILD_JSON")
BUILD_NUMBER="${BUILD_NUMBER//$'\n'/}"
echo "    next CFBundleVersion = $BUILD_NUMBER"
if [[ -z "$BUILD_NUMBER" || "$BUILD_NUMBER" == "null" ]]; then
  echo "Could not resolve next build number" >&2
  exit 1
fi

ARCHIVE=".asc/artifacts/keyverse-${VERSION}-${BUILD_NUMBER}.xcarchive"
IPA=".asc/artifacts/keyverse-${VERSION}-${BUILD_NUMBER}.ipa"

echo "==> Archive ($SCHEME Release, MARKETING_VERSION=$VERSION CURRENT_PROJECT_VERSION=$BUILD_NUMBER)"
asc xcode archive \
  --workspace "$WORKSPACE" \
  --scheme "$SCHEME" \
  --configuration Release \
  --archive-path "$ARCHIVE" \
  --clean \
  --overwrite \
  --xcodebuild-flag=-destination \
  --xcodebuild-flag=generic/platform=iOS \
  --xcodebuild-flag=-allowProvisioningUpdates \
  --xcodebuild-flag="DEVELOPMENT_TEAM=$TEAM" \
  --xcodebuild-flag="MARKETING_VERSION=$VERSION" \
  --xcodebuild-flag="CURRENT_PROJECT_VERSION=$BUILD_NUMBER" \
  --output json

echo "==> Export IPA"
asc xcode export \
  --archive-path "$ARCHIVE" \
  --export-options "$EXPORT_OPTS" \
  --ipa-path "$IPA" \
  --overwrite \
  --timeout 15m \
  --xcodebuild-flag=-allowProvisioningUpdates \
  --output json

# --- Verify binary identity before talking to ASC (prevents ITMS-90345) ---
echo "==> Verify IPA versions match request"
VERIFY_DIR=$(mktemp -d)
trap 'rm -rf "$VERIFY_DIR"' EXIT
unzip -q -o "$IPA" -d "$VERIFY_DIR"
APP_PLIST=$(find "$VERIFY_DIR/Payload" -name Info.plist -maxdepth 2 | head -1)
if [[ -z "$APP_PLIST" || ! -f "$APP_PLIST" ]]; then
  echo "FATAL: no Info.plist inside IPA $IPA" >&2
  exit 1
fi
IPA_BUILD=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$APP_PLIST")
IPA_MARKETING=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP_PLIST")
echo "    IPA  CFBundleShortVersionString=$IPA_MARKETING  CFBundleVersion=$IPA_BUILD"
echo "    want MARKETING_VERSION=$VERSION  CURRENT_PROJECT_VERSION=$BUILD_NUMBER"

if [[ "$IPA_BUILD" != "$BUILD_NUMBER" ]]; then
  echo "FATAL: ITMS-90345 prevention — IPA CFBundleVersion ($IPA_BUILD) != requested build ($BUILD_NUMBER)." >&2
  echo "       Do not upload. Fix Info.plist / xcodebuild version flags and rebuild." >&2
  exit 1
fi
if [[ "$IPA_MARKETING" != "$VERSION" ]]; then
  echo "FATAL: IPA marketing version ($IPA_MARKETING) != requested ($VERSION)." >&2
  exit 1
fi

# Always pass build-number from the IPA (single source of truth)
BUILD_NUMBER="$IPA_BUILD"
VERSION="$IPA_MARKETING"

echo "==> Publish TestFlight (group: $GROUP, version $VERSION build $BUILD_NUMBER)"
asc publish testflight \
  --app "$APP_ID" \
  --ipa "$IPA" \
  --version "$VERSION" \
  --build-number "$BUILD_NUMBER" \
  --group "$GROUP" \
  --wait \
  --poll-interval 15s \
  --test-notes "keyverse internal TestFlight — version $VERSION ($BUILD_NUMBER)." \
  --locale en-US \
  --notify \
  --output json \
  --pretty

echo "Done. IPA: $IPA  (version $VERSION build $BUILD_NUMBER)"
