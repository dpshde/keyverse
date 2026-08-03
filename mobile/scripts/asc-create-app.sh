#!/usr/bin/env bash
# Create Bundle ID (if needed) + App Store Connect app via asc web session.
# Requires: asc web auth login (password + 2FA interactively once).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BUNDLE_ID="${ASC_BUNDLE_ID:-dev.dpslabs.keyverse}"
NAME="${ASC_APP_NAME:-keyverse}"
SKU="${ASC_SKU:-keyverse-ios}"
VERSION="${ASC_VERSION:-0.1.0}"
LOCALE="${ASC_PRIMARY_LOCALE:-en-US}"

echo "==> Ensure bundle ID $BUNDLE_ID exists"
if ! asc bundle-ids list --paginate --output json 2>/dev/null \
  | python3 -c "import json,sys; d=json.load(sys.stdin); ids=[x['attributes']['identifier'] for x in d.get('data',[])]; sys.exit(0 if '$BUNDLE_ID' in ids else 1)"; then
  asc bundle-ids create \
    --identifier "$BUNDLE_ID" \
    --name "$NAME" \
    --platform IOS \
    --output json --pretty
else
  echo "    already registered"
fi

echo "==> Web session"
if ! asc web auth status --output json 2>/dev/null | python3 -c "import json,sys; sys.exit(0 if json.load(sys.stdin).get('authenticated') else 1)"; then
  echo "Not authenticated for asc web."
  echo "Run:  asc web auth login --apple-id YOUR@EMAIL"
  echo "Then re-run this script."
  exit 1
fi

echo "==> Create app on App Store Connect"
CREATE_OUT=$(asc web apps create \
  --name "$NAME" \
  --bundle-id "$BUNDLE_ID" \
  --sku "$SKU" \
  --primary-locale "$LOCALE" \
  --platform IOS \
  --version "$VERSION" \
  --output json --pretty)
echo "$CREATE_OUT"

APP_ID=$(python3 - <<'PY' <<<"$CREATE_OUT"
import json,sys,re
raw=sys.stdin.read()
try:
  d=json.loads(raw)
except Exception:
  # fallback: find "id": "digits"
  m=re.search(r'"id"\s*:\s*"(\d{6,})"', raw)
  print(m.group(1) if m else "")
  raise SystemExit
# common shapes
if isinstance(d, dict):
  if "data" in d and isinstance(d["data"], dict):
    print(d["data"].get("id") or d["data"].get("attributes",{}).get("adamId") or "")
  else:
    print(d.get("id") or d.get("appId") or d.get("adamId") or "")
else:
  print("")
PY
)

if [[ -z "$APP_ID" ]]; then
  # list by bundle id
  APP_ID=$(asc apps list --bundle-id "$BUNDLE_ID" --output json \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data'][0]['id'] if d.get('data') else '')")
fi

if [[ -z "$APP_ID" ]]; then
  echo "Could not resolve APP_ID — check ASC UI." >&2
  exit 1
fi

echo "==> App ID: $APP_ID"
mkdir -p .asc
cat > .asc/env.local <<EOF
export ASC_APP_ID="$APP_ID"
export ASC_BUNDLE_ID="$BUNDLE_ID"
export ASC_TEAM_ID="467UZHSCC3"
export ASC_VERSION="$VERSION"
export ASC_SCHEME="keyverse"
export ASC_WORKSPACE="ios/keyverse.xcworkspace"
export ASC_EXPORT_OPTIONS=".asc/export-options-app-store.plist"
export ASC_TESTFLIGHT_GROUP="Internal Testers"
EOF
echo "Wrote .asc/env.local"

echo "==> Free pricing + all territories (best-effort)"
asc app-setup pricing set --app "$APP_ID" --free 2>/dev/null || true
asc app-setup availability edit --app "$APP_ID" --all-territories --available true --available-in-new-territories true 2>/dev/null || true

echo "==> Encryption exemption (Info.plist ITSAppUsesNonExemptEncryption=false)"
asc encryption declarations exempt-declare --plist ios/keyverse/Info.plist 2>/dev/null || true

echo "Next:  ./scripts/testflight.sh"
echo "Or:    source .asc/env.local && ./scripts/testflight.sh"
