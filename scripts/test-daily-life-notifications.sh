#!/usr/bin/env bash
# The consent extensions must pass the original delivery/fencing suite too.
set -euo pipefail
task_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
exec bash "$task_root/scripts/test-notification-deliveries.sh"
