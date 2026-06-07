#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$REPO_ROOT/apps/tma/dist"
INDEX_FILE="$DIST_DIR/index.html"

cd "$REPO_ROOT"
rm -rf "$DIST_DIR"

VITE_API_BASE_URL="https://archlinux.tail2492c9.ts.net" \
VITE_ALLOW_MOCK_DATA="false" \
VITE_BASE_PATH="/tma/" \
pnpm --filter @lifeos/tma build

if [[ ! -f "$INDEX_FILE" ]]; then
  printf 'ERROR: TMA build did not create %s\n' "$INDEX_FILE" >&2
  exit 1
fi

if ! grep -q '/tma/assets/' "$INDEX_FILE"; then
  printf 'ERROR: %s does not contain /tma/assets/ paths\n' "$INDEX_FILE" >&2
  exit 1
fi

if grep -Eq '(src|href)="/assets/' "$INDEX_FILE"; then
  printf 'ERROR: %s contains broken root /assets/ paths\n' "$INDEX_FILE" >&2
  exit 1
fi

printf 'OK: self-host TMA built with /tma/assets/ paths\n'
