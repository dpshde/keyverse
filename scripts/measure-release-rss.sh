#!/usr/bin/env bash
# Build Mix release and report RSS while serving /health + a small write load.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export MIX_ENV=prod
export HOST=127.0.0.1
export PORT="${PORT:-4317}"
export PACK_DIR="${PACK_DIR:-/tmp/kv-release-rss}"
export FATHOM_SITE=off
export RELEASE_DISTRIBUTION=none
rm -rf "$PACK_DIR"
mkdir -p "$PACK_DIR"

mix deps.get --only prod
mix release --overwrite >/tmp/kv-release-build.log

BIN="$ROOT/_build/prod/rel/keyverse/bin/keyverse"
"$BIN" start >/tmp/kv-release-run.log 2>&1 &
# release start may daemonize on some versions — poll health
for i in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null; then
    break
  fi
  sleep 0.25
done

curl -sf "http://127.0.0.1:${PORT}/health" | tee /tmp/kv-release-health.json
echo

# find beam
BEAM_PID="$(pgrep -f "rel/keyverse.*beam|bin/keyverse" | head -1 || true)"
if [[ -z "${BEAM_PID}" ]]; then
  BEAM_PID="$(pgrep -f "beam.smp.*keyverse" | head -1 || true)"
fi
RSS_IDLE="$(ps -p "${BEAM_PID:-0}" -o rss= 2>/dev/null | tr -d ' ' || echo 0)"

# small load
DOOR="rss-bench-door-pack"
curl -sf -X POST "http://127.0.0.1:${PORT}/setup" \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data "intent=claim&door=${DOOR}" -o /dev/null -w '%{http_code}\n' || true
for i in $(seq 1 20); do
  curl -sf -X PUT "http://127.0.0.1:${PORT}/${DOOR}/api/note/jhn.3.$((i % 10 + 1))" \
    -H 'content-type: application/json' \
    -d "{\"blocks\":[{\"id\":\"b$i\",\"indent\":0,\"text\":\"n$i\"}]}" >/dev/null || true
done
# 1MB attachment
dd if=/dev/urandom of=/tmp/kv-1mb.bin bs=1024 count=1024 status=none
curl -sf -X POST "http://127.0.0.1:${PORT}/${DOOR}/api/note/jhn.3.16/attachments" \
  -H 'content-type: application/octet-stream' \
  -H 'x-filename: blob.bin' \
  --data-binary @/tmp/kv-1mb.bin >/dev/null || true

curl -sf "http://127.0.0.1:${PORT}/metrics" | head -c 800; echo
RSS_AFTER="$(ps -p "${BEAM_PID:-0}" -o rss= 2>/dev/null | tr -d ' ' || echo 0)"

echo "release_bin=$BIN"
echo "beam_pid=${BEAM_PID:-none}"
echo "rss_kb_idle=${RSS_IDLE}"
echo "rss_kb_after_load=${RSS_AFTER}"

"$BIN" stop >/dev/null 2>&1 || true
# fallback kill
if [[ -n "${BEAM_PID:-}" ]]; then kill "${BEAM_PID}" 2>/dev/null || true; fi
