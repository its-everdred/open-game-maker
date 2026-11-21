#!/usr/bin/env python3
"""Hourly retro check: is every Open-Games game's merged work actually live?

For each game, compares the newest commit on origin main touching games/<slug>/ with the newest successful
publish recorded in the Executor's og-merge/og-publish logs, and counts failed publishes since that success.
Prints one line per game; a game whose main is ahead of its last good publish for more than an hour, or with
2+ failed publishes since, is a P0 (Kevin 2026-11-21: Dusk Helm sat unpublished for a day; the retro must find
AND fix it).  Exit 1 when any game is stale.
"""
import glob, os, re, subprocess, sys, time

EXEC = os.path.expanduser('~/.aiur/repo/its-everdred/open-game-maker-2000/executor')
OG = os.path.expanduser('~/games/open-games')


def sh(*a):
    return subprocess.run(a, capture_output=True, text=True).stdout.strip()


def main():
    sh('git', '-C', OG, '-c', 'credential.helper=!gh auth git-credential', 'fetch', '-q',
       'https://github.com/its-everdred/open-games', 'main')
    games = sorted(os.path.basename(os.path.dirname(p)) for p in glob.glob(OG + '/games/*/package.json'))
    # (mtime, slug, ok) for every publish result line in the logs
    results = []
    for f in glob.glob(EXEC + '/og-merge-*.log') + glob.glob(EXEC + '/og-publish*.log'):
        mt = os.path.getmtime(f)
        for line in open(f, errors='ignore'):
            m = re.match(r'exit=(\d+) og-publish (\S+)', line.strip())
            if m:
                results.append((mt, m.group(2), m.group(1) == '0'))
    results.sort()
    stale = 0
    now = time.time()
    for g in games:
        main_ts = int(sh('git', '-C', OG, 'log', '-1', '--format=%ct', 'FETCH_HEAD', '--', f'games/{g}') or 0)
        mine = [r for r in results if r[1] == g]
        last_ok = max((r[0] for r in mine if r[2]), default=0)
        fails = sum(1 for r in mine if not r[2] and r[0] > last_ok)
        behind_h = (main_ts - last_ok) / 3600 if main_ts > last_ok else 0
        bad = fails >= 2 or (behind_h > 0 and now - main_ts > 3600)
        stale += bad
        print(f"{'P0 ' if bad else 'ok '}{g}: main {time.strftime('%m-%d %H:%MZ', time.gmtime(main_ts)) if main_ts else '-'}"
              f", last good publish {time.strftime('%m-%d %H:%MZ', time.gmtime(last_ok)) if last_ok else 'never'}"
              f", failed since {fails}")
    sys.exit(1 if stale else 0)


if __name__ == '__main__':
    main()
