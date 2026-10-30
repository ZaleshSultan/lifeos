#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/lifeos-selfhost-test.XXXXXX")"
trap 'rm -rf -- "$FIXTURE_ROOT"' EXIT
mkdir -p "$FIXTURE_ROOT/repo/scripts" "$FIXTURE_ROOT/repo/apps/tma/dist/assets" "$FIXTURE_ROOT/bin"
cp "$REPO_ROOT/scripts/build-tma-selfhost.sh" "$REPO_ROOT/scripts/deploy-selfhost.sh" \
  "$REPO_ROOT/scripts/publish-tma-build.mjs" "$FIXTURE_ROOT/repo/scripts/"
LIVE_DIR="$FIXTURE_ROOT/repo/apps/tma/dist"
printf '<script src="/tma/assets/old.js"></script><link href="/tma/assets/old.css">' > "$LIVE_DIR/index.html"
printf 'previous JavaScript' > "$LIVE_DIR/assets/old.js"
printf 'previous CSS' > "$LIVE_DIR/assets/old.css"

cat > "$FIXTURE_ROOT/bin/pnpm" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
[[ "$VITE_ALLOW_MOCK_DATA" == false && "$VITE_BASE_PATH" == /tma/ ]]
[[ "$VITE_API_BASE_URL" == https://lifeos.zalewko.me ]]
output=""
base=""
while (($#)); do
  case "$1" in
    --outDir) output="$2"; shift 2 ;;
    --base) base="$2"; shift 2 ;;
    *) shift ;;
  esac
done
[[ -n "$output" && "$base" == /tma/ && "$output" != */dist ]]
mkdir -p "$output/assets"
printf 'new JavaScript' > "$output/assets/new.js"
printf 'new CSS' > "$output/assets/new.css"
printf 'lazy JavaScript' > "$output/assets/lazy.js"
case "${BUILD_FIXTURE:-success}" in
  failed-build) exit 7 ;;
  missing-index) exit 0 ;;
  wrong-base) printf '<script src="/assets/new.js"></script><link href="/assets/new.css">' > "$output/index.html" ;;
  missing-asset) printf '<script src="/tma/assets/absent.js"></script><link href="/tma/assets/new.css">' > "$output/index.html" ;;
  collision)
    printf 'changed old JavaScript' > "$output/assets/old.js"
    printf '<script src="/tma/assets/new.js"></script><link href="/tma/assets/new.css">' > "$output/index.html"
    ;;
  *) printf '<script src="/tma/assets/new.js"></script><link href="/tma/assets/new.css">' > "$output/index.html" ;;
esac
STUB

cat > "$FIXTURE_ROOT/bin/sudo" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf 'sudo %s\n' "$*" >> "$COMMAND_LOG"
[[ "$1" == -n ]]
[[ "${SUDO_FIXTURE:-success}" == success ]]
STUB
cat > "$FIXTURE_ROOT/bin/systemctl" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf 'systemctl %s\n' "$*" >> "$COMMAND_LOG"
case "$*" in
  *' -p User '*)
    if [[ "${SERVICE_FIXTURE:-foreign}" == foreign ]]; then
      printf 'different-service-user\n'
    else
      id -un
    fi
    ;;
  *' -p Restart '*) printf 'always\n' ;;
  *' -p MainPID '*)
    if [[ "${SERVICE_FIXTURE:-foreign}" == restarted && -f "$COMMAND_LOG.restarted.pid-seen" ]]; then
      printf '999999998\n'
    else
      : > "$COMMAND_LOG.${SERVICE_FIXTURE:-foreign}.pid-seen"
      printf '999999999\n'
    fi
    ;;
esac
STUB
cat > "$FIXTURE_ROOT/bin/curl" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
output=""
agent=""
url=""
while (($#)); do
  case "$1" in
    --output) output="$2"; shift 2 ;;
    --user-agent) agent="$2"; shift 2 ;;
    http*) url="$1"; shift ;;
    *) shift ;;
  esac
done
[[ -n "$output" && "$agent" == 'Mozilla/5.0 '* ]]
if [[ "${CURL_FIXTURE:-healthy}" == html ]]; then
  printf '<html>Access denied</html>' > "$output"
elif [[ "${CURL_FIXTURE:-healthy}" == unhealthy ]]; then
  printf '{"status":"error"}' > "$output"
elif [[ "$url" == */healthz ]]; then
  printf '{"status":"ok"}' > "$output"
else
  printf '<script src="/tma/assets/new.js"></script>' > "$output"
fi
STUB
cat > "$FIXTURE_ROOT/bin/sleep" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
chmod +x "$FIXTURE_ROOT/bin/"*
export PATH="$FIXTURE_ROOT/bin:$PATH"
export COMMAND_LOG="$FIXTURE_ROOT/commands.log"

fingerprint() {
  node --input-type=module - "$LIVE_DIR" <<'NODE'
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const hash = createHash("sha256");
function visit(directory) {
  for (const file of readdirSync(directory, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
    hash.update(file.name);
    if (file.isDirectory()) visit(join(directory,file.name));
    else hash.update(readFileSync(join(directory,file.name)));
  }
}
visit(process.argv[2]);
console.log(hash.digest("hex"));
NODE
}

original="$(fingerprint)"
for failure in failed-build missing-index wrong-base missing-asset collision; do
  if BUILD_FIXTURE="$failure" bash "$FIXTURE_ROOT/repo/scripts/build-tma-selfhost.sh" > "$FIXTURE_ROOT/$failure.log" 2>&1; then
    printf 'FAIL: %s unexpectedly published\n' "$failure" >&2
    exit 1
  fi
  [[ "$(fingerprint)" == "$original" ]]
  printf 'PASS: %s leaves the live release unchanged\n' "$failure"
done

VITE_ALLOW_MOCK_DATA=true VITE_BASE_PATH=/wrong/ BUILD_FIXTURE=success \
  bash "$FIXTURE_ROOT/repo/scripts/build-tma-selfhost.sh" > "$FIXTURE_ROOT/success.log" 2>&1
[[ "$(cat "$LIVE_DIR/assets/old.js")" == 'previous JavaScript' ]]
[[ "$(cat "$LIVE_DIR/assets/old.css")" == 'previous CSS' ]]
[[ -f "$LIVE_DIR/assets/new.js" && -f "$LIVE_DIR/assets/new.css" && -f "$LIVE_DIR/assets/lazy.js" ]]
[[ "$(cat "$LIVE_DIR/index.html")" == *'/tma/assets/new.js'* ]]
printf 'PASS: successful staged build forces production settings and retains previous and lazy assets\n'

BUILD_FIXTURE=success bash "$FIXTURE_ROOT/repo/scripts/deploy-selfhost.sh" > "$FIXTURE_ROOT/deploy.log" 2>&1
[[ "$(cat "$COMMAND_LOG")" == $'sudo -n systemctl restart lifeos-bot.service\nsystemctl is-active --quiet lifeos-bot.service' ]]
printf 'PASS: deployment uses noninteractive sudo and restarts only the bot\n'

: > "$COMMAND_LOG"
if SUDO_FIXTURE=denied BUILD_FIXTURE=success bash "$FIXTURE_ROOT/repo/scripts/deploy-selfhost.sh" > "$FIXTURE_ROOT/denied.log" 2>&1; then
  printf 'FAIL: unsafe cross-user restart unexpectedly succeeded\n' >&2
  exit 1
fi
[[ "$(cat "$COMMAND_LOG")" == *'sudo -n systemctl restart lifeos-bot.service'* ]]
[[ "$(cat "$COMMAND_LOG")" != *'daily-digest'* ]]
printf 'PASS: unavailable sudo refuses an unsafe process-signal fallback\n'

# Export a stub for bash's kill builtin so fallback fixtures cannot signal a
# real process, even if a fixture PID happens to exist on the host.
kill() { printf 'kill %s\n' "$*" >> "$COMMAND_LOG"; }
export -f kill
: > "$COMMAND_LOG"
SUDO_FIXTURE=denied SERVICE_FIXTURE=restarted BUILD_FIXTURE=success \
  bash "$FIXTURE_ROOT/repo/scripts/deploy-selfhost.sh" > "$FIXTURE_ROOT/restarted.log" 2>&1
[[ "$(cat "$COMMAND_LOG")" == *'kill -TERM 999999999'* ]]
[[ "$(cat "$COMMAND_LOG")" != *'kill -KILL'* ]]
printf 'PASS: same-user Restart=always fallback waits for a replacement PID after TERM\n'

: > "$COMMAND_LOG"
if SUDO_FIXTURE=denied SERVICE_FIXTURE=timeout BUILD_FIXTURE=success \
  bash "$FIXTURE_ROOT/repo/scripts/deploy-selfhost.sh" > "$FIXTURE_ROOT/timeout.log" 2>&1; then
  printf 'FAIL: stalled process restart unexpectedly succeeded\n' >&2
  exit 1
fi
[[ "$(cat "$COMMAND_LOG")" == *'kill -TERM 999999999'* ]]
[[ "$(cat "$COMMAND_LOG")" != *'kill -KILL'* ]]
printf 'PASS: stalled fallback stops without escalating to KILL\n'

for invalid_health in html unhealthy; do
  if CURL_FIXTURE="$invalid_health" BUILD_FIXTURE=success \
    bash "$FIXTURE_ROOT/repo/scripts/deploy-selfhost.sh" > "$FIXTURE_ROOT/health-$invalid_health.log" 2>&1; then
    printf 'FAIL: HTTP 200 with %s health body unexpectedly succeeded\n' "$invalid_health" >&2
    exit 1
  fi
  printf 'PASS: HTTP 200 with %s body fails health verification\n' "$invalid_health"
done

printf 'OK: 12 self-host deployment fixtures passed; no live build or service was touched\n'
