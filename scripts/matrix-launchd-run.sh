#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

mkdir -p .data/logs

export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
export NODE_ENV=production
export MATRIX_APP_PORT="${MATRIX_APP_PORT:-3010}"
export MATRIX_APP_HOST="${MATRIX_APP_HOST:-127.0.0.1}"
export PORT="$MATRIX_APP_PORT"
SERVER_URL="http://${MATRIX_APP_HOST}:${MATRIX_APP_PORT}"

if ! command -v bun >/dev/null 2>&1; then
  echo "[matrix-launchd] bun not found in PATH=$PATH" >&2
  exit 1
fi

if [[ "${MATRIX_BUILD_ON_BOOT:-1}" == "1" || ! -f .next/BUILD_ID ]]; then
  echo "[matrix-launchd] Building production bundle..."
  bun --bun next build
fi

echo "[matrix-launchd] Starting Next.js production server on ${MATRIX_APP_HOST}:${MATRIX_APP_PORT}"
bun --bun next start --hostname "$MATRIX_APP_HOST" --port "$MATRIX_APP_PORT" &
SERVER_PID=$!

cleanup() {
  if kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup INT TERM EXIT

for _ in {1..60}; do
  if curl -fsS "$SERVER_URL/api/identity" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

if curl -fsS "$SERVER_URL/api/identity" >/dev/null 2>&1; then
  echo "[matrix-launchd] Ensuring FRP tunnel is aligned with runtime port ${MATRIX_APP_PORT}"
  curl -fsS -X POST "$SERVER_URL/api/frp" \
    -H 'Content-Type: application/json' \
    --data '{"action":"start"}' >/dev/null || echo "[matrix-launchd] FRP start request failed" >&2
else
  echo "[matrix-launchd] Server did not become ready in time; skipping FRP start" >&2
fi

wait "$SERVER_PID"
