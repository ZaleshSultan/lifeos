#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$REPO_ROOT/apps/tma/dist"
STAGING_DIR="$(mktemp -d "$REPO_ROOT/apps/tma/.selfhost-build.XXXXXX")"
trap 'rm -rf -- "$STAGING_DIR"' EXIT

cd "$REPO_ROOT"

VITE_API_BASE_URL="https://lifeos.zalewko.me" \
VITE_ALLOW_MOCK_DATA="false" \
VITE_BASE_PATH="/tma/" \
pnpm --filter @lifeos/tma build --outDir "$STAGING_DIR" --base /tma/

node "$REPO_ROOT/scripts/publish-tma-build.mjs" "$STAGING_DIR" "$DIST_DIR"

printf 'OK: self-host TMA published with /tma/assets/ paths; previous assets retained\n'
