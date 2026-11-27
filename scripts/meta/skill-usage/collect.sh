#!/usr/bin/env bash
# Collect from any working directory; report missing overlap configuration.
set -euo pipefail
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$repo_dir"
mkdir -p assets-local/experiments/skills
exec 9>assets-local/experiments/skills/collect.lock
flock 9
status=0
python3 scripts/meta/skill-usage/scan.py || status=1
python3 scripts/meta/skill-usage/scan2.py || status=1
result=0
python3 scripts/meta/skill-usage/metadata.py || result=$?
if [ "$result" -eq 75 ]; then exit "$result"; fi
if [ "$result" -ne 0 ]; then status=1; fi
result=0
python3 scripts/meta/skill-usage/scan-posts.py || result=$?
if [ "$result" -eq 75 ]; then exit "$result"; fi
if [ "$result" -ne 0 ]; then status=1; fi
python3 scripts/meta/skill-usage/experiment-report.py || status=1
overlap_config=assets-local/experiments/overlaps/config.json
if [ -f "$overlap_config" ]; then
  node scripts/meta/overlap-collect.ts --config "$overlap_config" --output assets-local/experiments/overlaps/reports || status=1
else
  printf '%s\n' 'overlap collector: no instance config; hourly overlap metrics are unavailable' >&2
fi
exit "$status"
