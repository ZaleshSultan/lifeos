#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

corepack pnpm format:check
corepack pnpm typecheck
corepack pnpm test
corepack pnpm --filter @lifeos/tma build
corepack pnpm --filter @lifeos/web build
python -m py_compile workers/obsidian-mirror/obsidian_mirror.py

if [ -x apps/health-bridge/gradlew ]; then
  (cd apps/health-bridge && ./gradlew test)
else
  echo "Skipping Android Gradle test: wrapper is not committed in scaffold."
fi
