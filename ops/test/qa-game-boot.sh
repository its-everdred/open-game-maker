#!/usr/bin/env bash
# ogm-qa-game-boot against a local games host: a build whose entry script loads passes; a build carrying the
# c85b055b8 `.//a/` rewrite (in the page or a script), or whose script 404s, fails (#1197: every prod game stuck on its loading layer for a day).

set -euo pipefail

test_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo=$(git -C "$test_dir" rev-parse --show-toplevel)
source "$test_dir/lib.sh"

scratch=$(mktemp -d)
server=
trap '[[ -n $server ]] && kill "$server"; rm -rf -- "$scratch"' EXIT
check=$repo/ops/bin/ogm-qa-game-boot
root=$scratch/root
page() {
  mkdir -p "$root/g/$1/$2"
  printf '<!doctype html><script type="module" crossorigin src="%s"></script>\n' "$3" > "$root/g/$1/$2/index.html"
}
mkdir -p "$root/a"
echo 'console.log(1)' > "$root/a/good.js"
page g_ok build_new /a/good.js
page g_ok build_old /a/missing.js

db=$scratch/ogm.sqlite3
python3 - "$db" << 'PY'
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
c.execute('create table games (id text, slug text, delisted_at text)')
c.execute('create table builds (id text, game_id text, status text, created_at text)')
c.executemany('insert into games values (?, ?, null)', [('g_ok', 'ok'), ('g_bad', 'bad'), ('g_qa', 'qa-review')])
c.executemany('insert into builds values (?, ?, ?, ?)', [
  ('build_old', 'g_ok', 'tested', '2026-11-20'), ('build_new', 'g_ok', 'tested', '2026-11-21'),
  ('build_bad', 'g_bad', 'tested', '2026-11-21'), ('build_qa', 'g_qa', 'tested', '2026-11-21')])
c.commit()
PY

port=$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
python3 -m http.server --bind 127.0.0.1 --directory "$root" "$port" > /dev/null 2>&1 &
server=$!
for _ in $(seq 50); do curl -fs "http://127.0.0.1:$port/a/good.js" > /dev/null && break; sleep 0.1; done
origin=http://127.0.0.1:$port

# Only the latest tested build counts, and QA games are skipped: the good game passes alone.
page g_bad build_bad /a/good.js
"$check" --db "$db" --origin "$origin" > "$scratch/out"
assert_grep 'ok build_new: ok' "$scratch/out"
assert_not_grep 'qa-review' "$scratch/out"
assert_grep 'exit=0 qa-game-boot' "$scratch/out"

# The double-rewritten entry from c85b055b8 fails even before it is fetched.
page g_bad build_bad .//a/good.js
set +e
"$check" --db "$db" --origin "$origin" > "$scratch/out"
rc=$?
set -e
assert_eq 1 "$rc" 'a .//a/ entry fails'
assert_grep 'bad build_bad: broken reference .//a/good.js' "$scratch/out"

# An entry script that 404s fails.
page g_bad build_bad ./missing.js
set +e
"$check" --db "$db" --origin "$origin" > "$scratch/out"
rc=$?
set -e
assert_eq 1 "$rc" 'a missing entry fails'
assert_grep 'bad build_bad: ./missing.js 404' "$scratch/out"

# A script that loads but names its data as `assets//a/<hash>.json` (the second half of the rewrite bug) fails.
hash=$(printf 'x%.0s' {1..64} | tr x 0)
printf 'fetch(new URL("assets//a/%s.json", document.baseURI))\n' "$hash" > "$root/a/glued.js"
page g_bad build_bad /a/glued.js
set +e
"$check" --db "$db" --origin "$origin" > "$scratch/out"
rc=$?
set -e
assert_eq 1 "$rc" 'a script with a glued address fails'
assert_grep "bad build_bad: /a/glued.js holds broken reference assets//a/$hash.json" "$scratch/out"

echo 'qa-game-boot: ok'
