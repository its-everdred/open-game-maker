#!/usr/bin/env bash
set -euo pipefail
node --test "$(dirname -- "${BASH_SOURCE[0]}")/qa-executor-notify.test.ts"
