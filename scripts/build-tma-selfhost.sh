#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# Empty API base uses the serving origin. Never bake a personal hostname into JS.
export VITE_API_BASE_URL="${VITE_API_BASE_URL:-}"
export VITE_ALLOW_MOCK_DATA=false
export VITE_BASE_PATH="${VITE_BASE_PATH:-/tma/}"
TMA_BUILD_DIR="${TMA_BUILD_DIR:-$REPO_ROOT/apps/tma/dist}"
if [[ "$VITE_BASE_PATH" != /tma/ ]]; then
  printf 'ERROR: bot self-hosting serves /tma/; VITE_BASE_PATH must be /tma/\n' >&2
  exit 1
fi
cd "$REPO_ROOT"
corepack pnpm --filter @lifeos/tma build --outDir "$TMA_BUILD_DIR"
python3 - "$TMA_BUILD_DIR/index.html" <<'PY'
from pathlib import Path
import sys
index = Path(sys.argv[1]).read_text()
if '/tma/assets/' not in index or '="/assets/' in index:
    raise SystemExit('ERROR: built assets must use /tma/assets/')
print('OK: self-host TMA built with /tma/assets/ paths')
PY
