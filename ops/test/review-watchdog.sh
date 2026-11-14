#!/usr/bin/env bash
set -euo pipefail
repo=$(git -C "$(dirname -- "$0")" rev-parse --show-toplevel)
node --test "$repo/ops/test/review-watchdog.test.mjs"
