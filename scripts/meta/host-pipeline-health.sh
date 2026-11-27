#!/usr/bin/env bash
# Hourly meta check of the Executor's OWN host pipeline: the steps between a worker's round and Kevin's review page.
# Kevin 2026-11-27: "the whole purpose of /meta-improve is to review the full current state of work and glean
# patterns. you should have caught this issue days ago". A stale preview held the capture port and 25 rounds produced no
# stills over 3 days, while every hourly pass only logged what the Executor had done.
# Prints one line per finding; silent when healthy. Usage: host-pipeline-health.sh [hours=24]
H=${1:-24}; M=$((H*60))
E=/home/orangekid/.aiur/repo/its-everdred/open-game-maker-2000/executor
REV=/home/orangekid/games/open-game-maker-2000/assets-local/review
S=$(ls -dt /tmp/claude-1001/-home-orangekid-games-open-game-maker-2000/*/scratchpad 2>/dev/null | head -1)

# 1. Capture runs in the window that produced no images (host failure, not a worker's).
n=0; ex=""; for f in $(find "$REV" -name run.log -mmin -$M 2>/dev/null); do
  d=$(dirname "$f"); [ "$(find "$d" -name '*.png' | wc -l)" -eq 0 ] && { n=$((n+1)); ex="$ex $(echo "$d" | sed "s#$REV/##")"; }; done
[ $n -gt 0 ] && echo "CAPTURE-FAILED $n runs with no images in ${H}h:$(echo $ex | tr ' ' '\n' | head -5 | tr '\n' ' ') cause: $(grep -h -m1 -E 'Error|exit=1' $(find "$REV" -name run.log -mmin -$M) 2>/dev/null | sort | uniq -c | sort -rn | head -1 | cut -c1-140)"

# 2. Repeated host-step failures.
grep -h "exit=1" "$E"/host-steps.log 2>/dev/null | tail -500 | sed -E 's/[0-9a-f]{7,}//g; s/#[0-9]+//g' | sort | uniq -c | sort -rn | awk '$1>=3' | head -3 | sed 's/^ */HOST-STEP-REPEAT x/'

# 3. Loops whose log went quiet (a dead loop stops everything downstream).
for l in host-steps.log auto-update.log; do  # automerge.log only logs events; check its pid instead
pgrep -f "^bash .*executor/automerge.sh" >/dev/null || echo "LOOP-DEAD automerge.sh not running"
 f="$E/$l"; [ -f "$f" ] && [ $(( ($(date +%s) - $(stat -c %Y "$f")) / 60 )) -gt 45 ] && echo "LOOP-QUIET $l last write $(( ($(date +%s) - $(stat -c %Y "$f")) / 60 )) min ago"; done

# 4. Long-lived preview or dev servers (orphans hold ports).
for p in $(pgrep -f 'vite.*preview|http.server' 2>/dev/null); do t=$(ps -o etimes= -p $p 2>/dev/null); [ "${t:-0}" -gt 7200 ] && echo "ORPHAN-SERVER pid $p up $((t/3600))h: $(tr '\0' ' ' < /proc/$p/cmdline | cut -c1-100)"; done

# 5. Review-page items waiting on media for over an hour, and attention lines nobody acted on.
[ -n "$S" ] && [ -f "$S/waiting-media.txt" ] && w=$(grep -c . "$S/waiting-media.txt") && [ "$w" -gt 0 ] && echo "WAITING-MEDIA $w rounds without media (scratchpad/waiting-media.txt)"
[ -n "$S" ] && [ -f "$S/aiur-replies.md" ] && a=$(grep -c "host-steps" "$S/aiur-replies.md") && [ "$a" -gt 0 ] && echo "HS-ATTENTION $a host-steps attention lines in aiur-replies.md (read them)"

# 6. Tickets that errored repeatedly (same symptom recurring = unfixed root cause).
for r in open-game-maker open-games; do gh issue list -R its-everdred/$r --label agent:error --state open --json number -q '.[].number' 2>/dev/null | while read -r i; do
  c=$(gh issue view $i -R its-everdred/$r --json comments -q '[.comments[]|select(.body|test("no-op turn limit|orphaned in-progress claim"))]|length' 2>/dev/null); [ "${c:-0}" -ge 2 ] && echo "REPEAT-ERROR $r#$i $c no-op/orphan events"; done; done
exit 0
