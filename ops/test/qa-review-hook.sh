#!/usr/bin/env bash
# ogm-qa-review-hook against a scratch repository and a fake gm: a deploy that leaves the review screens and API alone
# runs nothing; one that touches them refreshes the QA session and runs the E2E; a failing E2E wakes the Executor with
# one line in the attention file, and a passing one leaves it alone.

set -euo pipefail

test_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo=$(git -C "$test_dir" rev-parse --show-toplevel)
source "$test_dir/lib.sh"

scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
hook=$repo/ops/bin/ogm-qa-review-hook
export OGM_QA_ROOT=$scratch/state

stack=$scratch/stack
git init -q "$stack"
commit() {
  mkdir -p "$stack/$(dirname -- "$1")"
  printf '%s\n' "$RANDOM" >> "$stack/$1"
  git -C "$stack" add -A
  git -C "$stack" -c user.name=t -c user.email=t@example.test commit -qm "$1"
  git -C "$stack" rev-parse HEAD
}
base=$(commit README.md)
other=$(commit apps/web/src/routes/games/Grid.tsx)
review=$(commit apps/web/src/routes/review/RoundReviews.tsx)
api=$(commit services/api/src/review-rounds/routes.ts)

# The fake gm records its arguments and passes or fails on demand.
cat > "$scratch/gm" << 'GM'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$OGM_TEST_CALLS"
rc=$OGM_TEST_RC
[[ $2 == voice-e2e ]] && rc=${OGM_TEST_RC_VOICE:-$OGM_TEST_RC}
printf 'exit=%s qa-%s\n' "$rc" "$2"
exit "$rc"
GM
printf '#!/usr/bin/env bash\necho session >> "$OGM_TEST_CALLS"\n' > "$scratch/session"
chmod +x "$scratch/gm" "$scratch/session"
export OGM_QA_GM=$scratch/gm OGM_QA_SESSION_CMD=$scratch/session OGM_TEST_CALLS=$scratch/calls
attention=$scratch/attention

# Bad usage.
set +e
"$hook" "$base" > /dev/null 2>&1
rc=$?
set -e
assert_eq 64 "$rc" 'one commit is bad usage'

# No review path changed: nothing runs.
: > "$scratch/calls"
OGM_TEST_RC=0 "$hook" "$base" "$other" --repo "$stack" --attention "$attention" > "$scratch/out"
assert_grep 'no review or voice change' "$scratch/out"
assert_eq '' "$(cat "$scratch/calls")" 'an unrelated deploy runs nothing'

# A review screen changed and the E2E passes: a fresh session, the E2E for the deployed SHA, no wake.
OGM_TEST_RC=0 "$hook" "$other" "$review" --repo "$stack" --attention "$attention" > "$scratch/out"
short=$(git -C "$stack" rev-parse --short=12 "$review")
assert_eq "session
qa review-e2e --sha $short --out $stack/assets-local/review/app/qa-e2e/$short" "$(cat "$scratch/calls")" 'review deploy runs the E2E'
assert_eq 'exit=0 qa-review-e2e' "$(cat "$scratch/out")" 'passes the E2E result line on'
[[ ! -e $attention ]] || fail 'a passing run woke the Executor'

# The review API changed and the E2E fails: exit 1 and one attention line naming the SHA and the log.
: > "$scratch/calls"
set +e
OGM_TEST_RC=1 "$hook" "$review" "$api" --repo "$stack" --attention "$attention" > "$scratch/out"
rc=$?
set -e
short=$(git -C "$stack" rev-parse --short=12 "$api")
assert_eq 1 "$rc" 'a failing E2E exits 1'
assert_eq 'exit=1 qa-review-e2e' "$(cat "$scratch/out")" 'passes the failing result line on'
assert_eq 1 "$(wc -l < "$attention")" 'one attention line'
assert_grep "qa-review-e2e failed on $short (exit 1): $OGM_QA_ROOT/review-e2e/$short.log" "$attention"
assert_grep 'exit=1 qa-review-e2e' "$OGM_QA_ROOT/review-e2e/$short.log"

# Every part of the deck triggers the run, not only files named review.
for path in apps/web/src/features/worker-builds/SwipeVerdict.tsx apps/web/src/features/commands-inbox/commands.ts \
  apps/web/src/app/StudioMenu.tsx services/api/src/commands/routes.ts services/api/src/previews/routes.ts \
  services/api/src/qa/routes.ts services/api/src/worker-progress/routes.ts services/api/src/blobs/review-url.ts \
  services/api/src/blob-proxy/routes.ts; do
  from=$(git -C "$stack" rev-parse HEAD)
  to=$(commit "$path")
  : > "$scratch/calls"
  OGM_TEST_RC=0 "$hook" "$from" "$to" --repo "$stack" > /dev/null
  assert_grep 'qa review-e2e' "$scratch/calls"
done

# A voice path changed (#879): the voice E2E runs, after a fresh session, with its own stills folder.
from=$(git -C "$stack" rev-parse HEAD)
to=$(commit services/voice-host/lib/ogm_voice/transport.ex)
short=$(git -C "$stack" rev-parse --short=12 "$to")
: > "$scratch/calls"
OGM_TEST_RC=0 "$hook" "$from" "$to" --repo "$stack" --attention "$attention" > "$scratch/out"
assert_eq "session
qa voice-e2e --sha $short --out $stack/assets-local/review/app/voice-e2e/$short" "$(cat "$scratch/calls")" 'voice deploy runs the voice E2E'
assert_eq 'exit=0 qa-voice-e2e' "$(cat "$scratch/out")" 'passes the voice result line on'

# Every voice path CI watches triggers it too: the hook and the voice host job read the same list.
while read -r path; do
  [[ $path == */ ]] && path=${path}x.ts
  from=$(git -C "$stack" rev-parse HEAD)
  to=$(commit "$path")
  : > "$scratch/calls"
  OGM_TEST_RC=0 "$hook" "$from" "$to" --repo "$stack" > /dev/null
  assert_grep 'qa voice-e2e' "$scratch/calls"
done < "$repo/ops/voice-paths"

# A deploy touching both runs both on one session; a failing voice run wakes the Executor with its own line.
from=$(git -C "$stack" rev-parse HEAD)
mkdir -p "$stack/packages/voice-client/src"
printf '%s\n' "$RANDOM" >> "$stack/apps/web/src/routes/review/RoundReviews.tsx"
printf '%s\n' "$RANDOM" >> "$stack/packages/voice-client/src/client.ts"
git -C "$stack" add -A
git -C "$stack" -c user.name=t -c user.email=t@example.test commit -qm both
to=$(git -C "$stack" rev-parse HEAD)
short=$(git -C "$stack" rev-parse --short=12 "$to")
: > "$scratch/calls"
: > "$attention"
set +e
OGM_TEST_RC=0 OGM_TEST_RC_VOICE=1 "$hook" "$from" "$to" --repo "$stack" --attention "$attention" > "$scratch/out"
rc=$?
set -e
assert_eq 1 "$rc" 'a failing voice E2E exits 1'
assert_eq "session
qa review-e2e --sha $short --out $stack/assets-local/review/app/qa-e2e/$short
qa voice-e2e --sha $short --out $stack/assets-local/review/app/voice-e2e/$short" "$(cat "$scratch/calls")" 'both runs, one session'
assert_eq "exit=0 qa-review-e2e
exit=1 qa-voice-e2e" "$(cat "$scratch/out")" 'both result lines'
assert_eq 1 "$(wc -l < "$attention")" 'only the failing run wakes the Executor'
assert_grep "qa-voice-e2e failed on $short (exit 1): $OGM_QA_ROOT/voice-e2e/$short.log" "$attention"

# A run that hangs is cut off, fails, and wakes the Executor rather than holding the next deploy's check.
printf '#!/usr/bin/env bash\nsleep 30\n' > "$scratch/hang"
chmod +x "$scratch/hang"
from=$(git -C "$stack" rev-parse HEAD)
to=$(commit packages/voice-client/src/dictation.ts)
: > "$attention"
set +e
OGM_QA_GM=$scratch/hang OGM_QA_TIMEOUT_SEC=1 "$hook" "$from" "$to" --repo "$stack" --attention "$attention" > "$scratch/out"
rc=$?
set -e
assert_eq 1 "$rc" 'a hung E2E fails'
assert_grep 'exit=124 qa-voice-e2e' "$scratch/out"
assert_grep 'qa-voice-e2e failed on' "$attention"

# The session cannot be minted: no E2E, exit 1, and the Executor is woken.
from=$(git -C "$stack" rev-parse HEAD)
to=$(commit apps/web/src/routes/review/RoundMedia.tsx)
printf '#!/usr/bin/env bash\necho session >> "$OGM_TEST_CALLS"\nexit 1\n' > "$scratch/session"
: > "$scratch/calls"
: > "$attention"
set +e
OGM_TEST_RC=0 "$hook" "$from" "$to" --repo "$stack" --attention "$attention" > "$scratch/out"
rc=$?
set -e
assert_eq 1 "$rc" 'a failed session exits 1'
assert_eq session "$(cat "$scratch/calls")" 'no E2E without a session'
assert_eq 1 "$(wc -l < "$attention")" 'a failed session wakes the Executor'

echo 'qa-review-hook: ok'
