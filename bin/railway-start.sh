#!/bin/sh
# Railway / container entrypoint for the Mix release.
set -eu

export MIX_ENV="${MIX_ENV:-prod}"
export HOST="${HOST:-0.0.0.0}"
export RELEASE_DISTRIBUTION="${RELEASE_DISTRIBUTION:-none}"

# Railpack copies the release under /app; allow local smoke with relative path.
if [ -x /app/_build/prod/rel/keyverse/bin/keyverse ]; then
  BIN=/app/_build/prod/rel/keyverse/bin/keyverse
elif [ -x ./_build/prod/rel/keyverse/bin/keyverse ]; then
  BIN=./_build/prod/rel/keyverse/bin/keyverse
else
  echo "keyverse release binary not found" >&2
  ls -la /app/_build/prod/rel 2>/dev/null || true
  ls -la /app 2>/dev/null || true
  exit 127
fi

echo "starting keyverse release: $BIN start"
echo "HOST=${HOST} PORT=${PORT:-unset} PACK_DIR=${PACK_DIR:-unset} RELEASE_DISTRIBUTION=${RELEASE_DISTRIBUTION}"
exec "$BIN" start
