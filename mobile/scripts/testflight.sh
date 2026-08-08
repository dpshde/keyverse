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
# asc ≥0.29 dropped `builds next-build-number`; derive max CFBundleVersion + 1.
BUILD_NUMBER=$(
  asc builds list --app "$APP_ID" --output json 2>/dev/null | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    print(1)
    raise SystemExit(0)
builds = d.get("data") or []
nums = []
for b in builds:
    v = (b.get("attributes") or {}).get("version")
    if v is None:
        continue
    try:
        nums.append(int(str(v).strip()))
    except ValueError:
        pass
print((max(nums) + 1) if nums else 1)
'
)
BUILD_NUMBER="${BUILD_NUMBER//$'\n'/}"
# Allow override for re-runs
if [[ -n "${ASC_BUILD_NUMBER:-}" ]]; then
  BUILD_NUMBER="$ASC_BUILD_NUMBER"
fi
echo "    next CFBundleVersion = $BUILD_NUMBER"
if [[ -z "$BUILD_NUMBER" || "$BUILD_NUMBER" == "null" ]]; then
  echo "Could not resolve next build number" >&2
  exit 1
fi

ARCHIVE=".asc/artifacts/keyverse-${VERSION}-${BUILD_NUMBER}.xcarchive"
IPA=".asc/artifacts/keyverse-${VERSION}-${BUILD_NUMBER}.ipa"
EXPORT_DIR=".asc/artifacts/export-${VERSION}-${BUILD_NUMBER}"

# Prefer full Xcode (not Command Line Tools). Override with DEVELOPER_DIR.
if [[ -z "${DEVELOPER_DIR:-}" ]]; then
  for cand in \
    "/Applications/Xcode.app/Contents/Developer" \
    "/Users/dps/Downloads/Xcode-beta.app/Contents/Developer" \
    "/Applications/Xcode-beta.app/Contents/Developer"; do
    if [[ -d "$cand" ]]; then
      export DEVELOPER_DIR="$cand"
      break
    fi
  done
fi
if ! xcodebuild -version >/dev/null 2>&1; then
  echo "FATAL: xcodebuild needs a full Xcode install (set DEVELOPER_DIR)." >&2
  exit 1
fi
echo "    DEVELOPER_DIR=${DEVELOPER_DIR:-default} ($(xcodebuild -version | head -1))"

rm -rf "$ARCHIVE" "$EXPORT_DIR"
mkdir -p "$EXPORT_DIR"

echo "==> Archive ($SCHEME Release, MARKETING_VERSION=$VERSION CURRENT_PROJECT_VERSION=$BUILD_NUMBER)"
xcodebuild archive \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$TEAM" \
  MARKETING_VERSION="$VERSION" \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  CODE_SIGN_STYLE=Automatic

echo "==> Export IPA"
# Prefer ASC API key for provisioning (no interactive Xcode account).
EXPORT_AUTH=()
KEY_PATH="${APPLE_API_KEY_PATH:-${ASC_KEY_PATH:-}}"
KEY_ID="${APPLE_API_KEY_ID:-${ASC_KEY_ID:-}}"
ISSUER="${APPLE_API_ISSUER:-${ASC_ISSUER_ID:-}}"
if [[ -n "$KEY_PATH" && -f "$KEY_PATH" && -n "$KEY_ID" && -n "$ISSUER" ]]; then
  EXPORT_AUTH=(
    -authenticationKeyPath "$KEY_PATH"
    -authenticationKeyID "$KEY_ID"
    -authenticationKeyIssuerID "$ISSUER"
  )
  echo "    using ASC API key auth for export"
fi
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportOptionsPlist "$EXPORT_OPTS" \
  -exportPath "$EXPORT_DIR" \
  -allowProvisioningUpdates \
  "${EXPORT_AUTH[@]}"

# xcodebuild names the IPA after the product; normalize to our path
EXPORTED_IPA=$(find "$EXPORT_DIR" -maxdepth 1 -name "*.ipa" | head -1)
if [[ -z "$EXPORTED_IPA" || ! -f "$EXPORTED_IPA" ]]; then
  echo "FATAL: no IPA in $EXPORT_DIR after export" >&2
  ls -la "$EXPORT_DIR" >&2 || true
  exit 1
fi
cp -f "$EXPORTED_IPA" "$IPA"
echo "    IPA ready: $IPA"

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

TEST_NOTES="${ASC_TEST_NOTES:-keyverse internal TestFlight — version $VERSION ($BUILD_NUMBER).}"
echo "==> Publish TestFlight (group: $GROUP, version $VERSION build $BUILD_NUMBER)"
# asc ≥0.29: --locale with --test-notes can fail ASC filter; upload+group first, then notes.
if ! asc publish testflight \
  --app "$APP_ID" \
  --ipa "$IPA" \
  --version "$VERSION" \
  --build-number "$BUILD_NUMBER" \
  --group "$GROUP" \
  --wait \
  --poll-interval 15s \
  --notify \
  --output json \
  --pretty; then
  echo "WARN: publish testflight returned non-zero; checking if build is already on ASC..." >&2
fi

# Ensure group membership + What to Test (idempotent-ish)
BUILD_ID=$(asc builds list --app "$APP_ID" --output json 2>/dev/null | python3 -c '
import json,sys
want=sys.argv[1]
d=json.load(sys.stdin)
for b in d.get("data") or []:
  if str((b.get("attributes") or {}).get("version") or "")==want:
    print(b["id"]); break
' "$BUILD_NUMBER" || true)
if [[ -n "${BUILD_ID:-}" ]]; then
  GROUP_ID=$(asc testflight beta-groups list --app "$APP_ID" --output json 2>/dev/null | python3 -c '
import json,sys
d=json.load(sys.stdin)
for g in d.get("data") or []:
  a=g.get("attributes") or {}
  if a.get("isInternalGroup") or "Internal" in (a.get("name") or ""):
    print(g["id"]); break
' || true)
  if [[ -n "${GROUP_ID:-}" ]]; then
    asc builds add-groups --build "$BUILD_ID" --group "$GROUP_ID" --output json 2>/dev/null || true
  fi
  LOC_ID=$(asc builds test-notes list --build "$BUILD_ID" --output json 2>/dev/null | python3 -c '
import json,sys
d=json.load(sys.stdin)
for x in d.get("data") or []:
  if (x.get("attributes") or {}).get("locale")=="en-US":
    print(x["id"]); break
' || true)
  if [[ -n "${LOC_ID:-}" ]]; then
    asc builds test-notes update --id "$LOC_ID" --whats-new "$TEST_NOTES" --output json 2>/dev/null || true
  else
    asc builds test-notes create --build "$BUILD_ID" --locale en-US --whats-new "$TEST_NOTES" --output json 2>/dev/null || true
  fi
  echo "    build id: $BUILD_ID"
fi

echo "Done. IPA: $IPA  (version $VERSION build $BUILD_NUMBER)"
