#!/usr/bin/env bash
# ogm-publish is a thin wrapper: its arguments reach `gm publish` unchanged and gm's answers and exit codes come back.
# The build-and-upload flow itself is tested in packages/gm-cli/test/publish.test.ts. Needs the built gm CLI (CI's
# ops tests run after the workspace build).

set -euo pipefail

test_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo=$(git -C "$test_dir" rev-parse --show-toplevel)
source "$test_dir/lib.sh"

scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
export HOME=$scratch/home
mkdir -p "$HOME/.config/ogm/env" "$scratch/outside"
printf 'OGM_API_PORT=1\nOGM_INTERNAL_TOKEN=internal-token-for-publish-tests\n' > "$HOME/.config/ogm/env/api.env"

publish=$repo/ops/bin/ogm-publish

"$publish" --help > "$scratch/help.txt" || fail "ogm-publish --help failed"
assert_grep 'usage: gm publish [<slug>] [--sha <ref>]' "$scratch/help.txt"

# Outside a game folder with no slug, gm refuses with its usage exit and a next step.
status=0
(cd "$scratch/outside" && "$publish" > /dev/null 2> "$scratch/err.txt") || status=$?
assert_eq 2 "$status" 'no slug outside a game folder exits 2'
assert_grep 'gm publish needs a game slug outside a game folder. Try: gm publish <slug>' "$scratch/err.txt"

printf 'ok\n'
