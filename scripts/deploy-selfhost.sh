#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
: "${TMA_URL:?Set TMA_URL to your HTTPS frontend URL, including /tma/}"
python3 - "$TMA_URL" <<'PY'
from urllib.parse import urlsplit
import sys
url = urlsplit(sys.argv[1])
if url.scheme != 'https' or not url.hostname or url.username or url.password or url.path != '/tma/':
    raise SystemExit('ERROR: TMA_URL must be https://YOUR_DOMAIN/tma/ without credentials')
PY
# Apply reviewed migrations and import syllabi before invoking this script.
# Build first; a failed build leaves the running frontend and services intact.
TMA_DEPLOY_STAGE="$(mktemp -d "$REPO_ROOT/apps/tma/.deploy-XXXXXX")"
TMA_BUILD_DIR="$TMA_DEPLOY_STAGE" bash "$REPO_ROOT/scripts/build-tma-selfhost.sh"
TMA_PREVIOUS_BUILD="$REPO_ROOT/apps/tma/dist.previous-$(date -u +%Y%m%dT%H%M%SZ)"
if [[ -d "$REPO_ROOT/apps/tma/dist" ]]; then
  mv -- "$REPO_ROOT/apps/tma/dist" "$TMA_PREVIOUS_BUILD"
fi
mv -- "$TMA_DEPLOY_STAGE" "$REPO_ROOT/apps/tma/dist"
# Do not send process signals or restart unrelated workers as a sudo fallback.
sudo systemctl restart lifeos-bot.service
systemctl is-active --quiet lifeos-bot.service
python3 "$REPO_ROOT/scripts/smoke-tma.py" "$TMA_URL"
printf 'OK: bot/TMA deployment passed; previous build: %s\n' "$TMA_PREVIOUS_BUILD"
