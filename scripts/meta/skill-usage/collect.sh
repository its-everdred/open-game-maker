#!/usr/bin/env bash
# Collect from any working directory; successful runs are silent.
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
exit "$status"
