#!/usr/bin/env bash
# ogm-qa-review-hook against a scratch repository and a fake gm: every deploy runs the paid-API check (#1221); a deploy
# that leaves the review screens and API alone runs nothing else; one that touches them refreshes the QA session and runs the E2E; a failing E2E wakes the Executor with
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
other=$(commit apps/web/src/routes/profile/Profile.tsx)
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
# The fake game boot check (#1197) records its call and passes unless OGM_TEST_RC_BOOT says otherwise.
printf '#!/usr/bin/env bash\necho game-boot >> "$OGM_TEST_CALLS"\nexit "${OGM_TEST_RC_BOOT:-0}"\n' > "$scratch/boot"
# The fake paid-API check (#1221) records its call in its own file and passes unless OGM_TEST_RC_PAID says otherwise.
printf '#!/usr/bin/env bash\necho paid-apis >> "$OGM_TEST_PAID"\nprintf "exit=%%s qa-paid-apis\\n" "${OGM_TEST_RC_PAID:-0}"\nexit "${OGM_TEST_RC_PAID:-0}"\n' > "$scratch/paid"
chmod +x "$scratch/gm" "$scratch/session" "$scratch/boot" "$scratch/paid"
export OGM_QA_GM=$scratch/gm OGM_QA_SESSION_CMD=$scratch/session OGM_TEST_CALLS=$scratch/calls
export OGM_QA_GAME_BOOT=$scratch/boot OGM_QA_PAID_APIS=$scratch/paid OGM_TEST_PAID=$scratch/paid-calls
attention=$scratch/attention

# Bad usage.
set +e
"$hook" "$base" > /dev/null 2>&1
rc=$?
set -e
assert_eq 64 "$rc" 'one commit is bad usage'

# No review path changed: only the paid-API check runs, on a fresh session, and passes without a wake.
: > "$scratch/calls"
OGM_TEST_RC=0 "$hook" "$base" "$other" --repo "$stack" --attention "$attention" > "$scratch/out"
assert_eq 'exit=0 qa-paid-apis' "$(cat "$scratch/out")" 'an unrelated deploy runs only the paid-API check'
assert_eq session "$(cat "$scratch/calls")" 'the paid-API check gets a session and no E2E'
assert_eq paid-apis "$(cat "$scratch/paid-calls")" 'the paid-API check runs on every deploy'
short=$(git -C "$stack" rev-parse --short=12 "$other")
assert_grep 'exit=0 qa-paid-apis' "$OGM_QA_ROOT/paid-apis/$short.log"
[[ ! -e $attention ]] || fail 'a passing paid-API check woke the Executor'
# A game's paid call that is no longer refused fails the deploy and wakes the Executor.
set +e
OGM_TEST_RC=0 OGM_TEST_RC_PAID=1 "$hook" "$base" "$other" --repo "$stack" --attention "$attention" > "$scratch/out"
rc=$?
set -e
assert_eq 1 "$rc" 'a paid-API refusal regression fails the deploy hook'
assert_grep "qa-paid-apis failed on $short (exit 1): $OGM_QA_ROOT/paid-apis/$short.log" "$attention"
rm -f "$attention"

# Each New Game dependency triggers its smoke, and the daily run does so without a change.
for path in templates/game-2d/src/main.ts packages/game-repo-template/src/repo.ts services/api/src/games/routes.ts services/commit/src/server.ts; do
  from=$(git -C "$stack" rev-parse HEAD)
  to=$(commit "$path")
  : > "$scratch/calls"
  OGM_TEST_RC=0 "$hook" "$from" "$to" --repo "$stack" > /dev/null
  assert_grep 'qa new-game-e2e' "$scratch/calls"
done
# A games-serving change runs the cache check and logs/alerts failures independently of New Game.
from=$(git -C "$stack" rev-parse HEAD)
to=$(commit services/games-host/src/server.ts)
: > "$scratch/calls"
OGM_TEST_RC=0 "$hook" "$from" "$to" --repo "$stack" --attention "$attention" > "$scratch/out"
assert_grep 'qa games-cache --game blobs --json' "$scratch/calls"
assert_grep 'exit=0 qa-games-cache' "$scratch/out"
short=$(git -C "$stack" rev-parse --short=12 "$to")
assert_grep 'exit=0 qa-games-cache' "$OGM_QA_ROOT/games-cache/$short.log"
assert_grep 'game-boot' "$scratch/calls"
# A games-serving deploy after which a published game's entry script 404s fails and wakes the Executor (#1197).
from=$to
to=$(commit services/api/src/builds/cache-plan.ts)
: > "$attention"
set +e
OGM_TEST_RC=0 OGM_TEST_RC_BOOT=1 "$hook" "$from" "$to" --repo "$stack" --attention "$attention" > "$scratch/out"
rc=$?
set -e
assert_eq 1 "$rc" 'a game that no longer boots fails the deploy hook'
assert_grep 'qa-game-boot failed on' "$attention"
assert_grep 'exit=0 qa-games-cache' "$scratch/out"
from=$to
to=$(commit services/api/src/builds/publish.ts)
: > "$scratch/calls"
set +e
OGM_TEST_RC=1 "$hook" "$from" "$to" --repo "$stack" --attention "$attention" > "$scratch/out"
rc=$?
set -e
assert_eq 1 "$rc" 'a failing games-cache check fails the deploy hook'
assert_grep 'qa-games-cache failed on' "$attention"
assert_grep 'exit=1 qa-games-cache' "$scratch/out"
short=$(git -C "$stack" rev-parse --short=12 "$to")
assert_grep 'exit=1 qa-games-cache' "$OGM_QA_ROOT/games-cache/$short.log"
: > "$attention"
: > "$scratch/calls"
OGM_TEST_RC=0 "$hook" "$to" "$to" --daily --repo "$stack" > /dev/null
assert_grep 'qa new-game-e2e' "$scratch/calls"
: > "$scratch/calls"
set +e
OGM_TEST_RC=1 "$hook" "$to" "$to" --daily --repo "$stack" > /dev/null
rc=$?
set -e
assert_eq 1 "$rc" 'a failing daily smoke fails'
assert_grep 'qa-new-game-e2e failed on' "$attention"
rm -f "$attention"
: > "$scratch/calls"

# Every game publish also checks that all published games still boot, and a broken one wakes the Executor.
: > "$scratch/calls"
OGM_TEST_RC=0 "$hook" --game-publish blobs build_1 --repo "$stack" --attention "$attention" > "$scratch/out"
assert_grep 'exit=0 qa-game-boot' "$scratch/out"
set +e
OGM_TEST_RC=0 OGM_TEST_RC_BOOT=1 "$hook" --game-publish blobs build_1 --repo "$stack" --attention "$attention" > "$scratch/out"
rc=$?
set -e
assert_eq 1 "$rc" 'a publish that leaves a game unbootable fails'
assert_grep 'qa-game-boot failed after publishing blobs' "$attention"
rm -f "$attention"
: > "$scratch/calls"

# A review screen changed and the E2E passes: a fresh session, the E2E for the deployed SHA, no wake.
OGM_TEST_RC=0 "$hook" "$other" "$review" --repo "$stack" --attention "$attention" > "$scratch/out"
short=$(git -C "$stack" rev-parse --short=12 "$review")
assert_eq "session
qa review-e2e --sha $short --out $stack/assets-local/review/app/qa-e2e/$short" "$(cat "$scratch/calls")" 'review deploy runs the E2E'
assert_eq 'exit=0 qa-review-e2e
exit=0 qa-paid-apis' "$(cat "$scratch/out")" 'passes the E2E result line on'
[[ ! -e $attention ]] || fail 'a passing run woke the Executor'

# The review API changed and the E2E fails: exit 1 and one attention line naming the SHA and the log.
: > "$scratch/calls"
set +e
OGM_TEST_RC=1 "$hook" "$review" "$api" --repo "$stack" --attention "$attention" > "$scratch/out"
rc=$?
set -e
short=$(git -C "$stack" rev-parse --short=12 "$api")
assert_eq 1 "$rc" 'a failing E2E exits 1'
assert_eq 'exit=1 qa-review-e2e
exit=0 qa-paid-apis' "$(cat "$scratch/out")" 'passes the failing result line on'
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
assert_eq 'exit=0 qa-voice-e2e
exit=0 qa-paid-apis' "$(cat "$scratch/out")" 'passes the voice result line on'

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
exit=1 qa-voice-e2e
exit=0 qa-paid-apis" "$(cat "$scratch/out")" 'both result lines'
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
