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

if ! command -v bun >/dev/null 2>&1; then
  echo "[matrix-launchd] bun not found in PATH=$PATH" >&2
  exit 1
fi

if [[ "${MATRIX_BUILD_ON_BOOT:-1}" == "1" || ! -f .next/BUILD_ID ]]; then
  echo "[matrix-launchd] Building production bundle..."
  bun --bun next build
fi

echo "[matrix-launchd] Starting Next.js production server on ${MATRIX_APP_HOST}:${MATRIX_APP_PORT}"
exec bun --bun next start --hostname "$MATRIX_APP_HOST" --port "$MATRIX_APP_PORT"
