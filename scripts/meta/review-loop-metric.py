#!/usr/bin/env python3
"""review-loop-metric.py: how long Kevin waits for the next review round.

The review loop (one iteration per verdict Kevin gives on the review page):

  raised --S1--> on page --S2--> VERDICT --S3--> relayed --S4--> worker has it
         --S5--> next round raised --S6--> next round on Kevin's page

  S1 page wait     Command created -> the page publish Kevin judged it on
  S2 Kevin         page publish -> Kevin's pick (his time, not ours; reported apart)
  S3 relay         pick -> the Executor relays it (answer recorded / ticket comment / rework label)
  S4 delivery      relay -> the verdict text reaches the worker's thread (first user message carrying it)
  S5 work          worker has it -> first new Command raised on that ticket (the only stage that is work)
  S6 page wait     new Command -> first page publish that carries it

  LOOP = S3+S4+S5+S6 = verdict -> next round visible to Kevin.   Target: median <= 15 min, worst <= 30 min.

Usage:
  scripts/meta/review-loop-metric.py                # the 1 h and 24 h windows (what the hourly meta pass logs)
  scripts/meta/review-loop-metric.py --hours 6      # one window
  scripts/meta/review-loop-metric.py --hours 24 --rows   # plus one line per iteration
  options: --no-gh (skip GitHub comment lookups), --picks DIR, --transcript FILE, --now ISO (replay)

The meta pass copies the `REVIEW_LOOP ...` lines into its `## Review loop` section and diffs them against the last pass.

Sources (all local files; no daemon RPC, so a slow or restarting daemon cannot stall it):
  Commands        ~/.config/aiur/<instance>/<repo>/decisions.json (+ decisions.ndjson for delivery events)
  Kevin's picks   <session scratchpad>/picks-live/picks/*.json and review-all-relayed.txt (first `at` per key);
                  without them the answer time in decisions.json stands in for the pick (S3 then reads 0)
  relays          answer.accepted_at, else the first verdict comment on the ticket (gh, 15 s timeout),
                  else the first agent.rework label event in ticket-events
  worker receipt  Codex rollouts of the ticket's workspace (first user message with the note or the decision id)
  page publishes  `Published .../review-all/index.html` results in the Executor session transcript, read
                  incrementally (offset cached in ~/.cache/ogm/review-loop-publishes.json)
Runs in a few seconds once the cache is warm (about 30 s cold on the 1 GB transcript).
"""
import argparse, glob, json, os, re, statistics, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

HOME = os.path.expanduser("~")
INSTANCES = {"core": ("e110d74831", "open-game-maker"), "open-games": ("940a3884be", "open-games")}
GH_REPO = {"core": "its-everdred/open-game-maker", "open-games": "its-everdred/open-games"}
PROJECT = "-home-orangekid-games-open-game-maker-2000"
CACHE = os.path.join(HOME, ".cache/ogm/review-loop-publishes.json")
STAGES = ["S3 relay", "S4 delivery", "S5 work", "S6 page wait"]


def ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None


def ms(n):
    return datetime.fromtimestamp(n / 1000, timezone.utc)


def mins(a, b):
    return None if a is None or b is None else max(0.0, (b - a).total_seconds() / 60)


def newest(pattern):
    hits = sorted(glob.glob(pattern), key=os.path.getmtime)
    return hits[-1] if hits else None


def load_commands():
    """Creator Commands of both repos: {decision_id: {...}} and {(repo, ticket): [sorted by created]}."""
    by_id, by_ticket = {}, {}
    for repo, (inst, name) in INSTANCES.items():
        base = os.path.join(HOME, ".config/aiur", inst, name)
        try:
            raw = json.load(open(os.path.join(base, "decisions.json")))["decisions"]
        except (OSError, ValueError, KeyError):
            print(f"note: no decision store for {repo}", file=sys.stderr)
            continue
        for d in (raw.values() if isinstance(raw, dict) else raw):
            if d.get("audience") not in ("creator", None) or d.get("route_policy") != "human_only":
                continue
            c = {"id": d["decision_id"], "repo": repo, "ticket": str((d.get("ticket") or {}).get("identifier")),
                 "created": ts(d.get("created_at")), "question": d.get("question") or "",
                 "answered": ts((d.get("answer") or {}).get("accepted_at")), "delivered": None}
            if c["created"] is None:
                continue
            by_id[c["id"]] = c
            by_ticket.setdefault((repo, c["ticket"]), []).append(c)
        try:
            for line in open(os.path.join(base, "decisions.ndjson")):
                if '"delivered"' not in line:
                    continue
                e = json.loads(line)
                c = by_id.get(e.get("decision_id"))
                if c and e.get("event_type") == "delivered" and c["delivered"] is None:
                    c["delivered"] = ts(e.get("occurred_at"))
        except (OSError, ValueError):
            pass
    for v in by_ticket.values():
        v.sort(key=lambda c: c["created"])
    return by_id, by_ticket


def load_picks(picks_dir, cmds):
    """Kevin's verdicts: {decision_id: {first, last, label, note}}. Falls back to recorded answers."""
    picks = {}
    if picks_dir and os.path.isdir(picks_dir):
        for f in glob.glob(os.path.join(picks_dir, "dec_*.json")):
            try:
                p = json.load(open(f))
            except (OSError, ValueError):
                continue
            key = os.path.basename(f)[:-5]
            choice = p.get("choice")
            picks[key] = {"first": ms(p["at"]), "last": ms(p["at"]), "note": (p.get("note") or "").strip(),
                          "label": p.get("label") or (choice if isinstance(choice, str) else "likes")}
        ledger = os.path.join(os.path.dirname(os.path.dirname(picks_dir.rstrip("/"))), "review-all-relayed.txt")
        if os.path.exists(ledger):
            for line in open(ledger):
                key, _, at = line.strip().partition("@")
                if key in picks and at.isdigit():
                    picks[key]["first"] = min(picks[key]["first"], ms(int(at)))
    for c in cmds.values():   # answers that never went through the page dump
        if c["answered"] and c["id"] not in picks:
            picks[c["id"]] = {"first": c["answered"], "last": c["answered"], "note": "", "label": "answered"}
    return picks


def load_publishes(transcript):
    """Review page publish times, from the Executor transcript, scanned incrementally."""
    state = {"file": None, "offset": 0, "times": []}
    try:
        state = json.load(open(CACHE))
    except (OSError, ValueError):
        pass
    if not transcript or not os.path.exists(transcript):
        return [ts(t) for t in state["times"]]
    if state.get("file") != transcript or state.get("offset", 0) > os.path.getsize(transcript):
        state = {"file": transcript, "offset": 0, "times": []}
    pat = re.compile(rb'"timestamp":"([^"]+)"')
    with open(transcript, "rb") as f:
        f.seek(state["offset"])
        while True:
            line = f.readline()
            if not line or not line.endswith(b"\n"):
                break                                   # a half-written last line is read next time
            state["offset"] = f.tell()
            if b"review-all/index.html" in line and b"Published /" in line and b'"tool_result"' in line:
                m = pat.search(line[-800:]) or pat.search(line)
                if m:
                    state["times"].append(m.group(1).decode())
    try:
        os.makedirs(os.path.dirname(CACHE), exist_ok=True)
        json.dump(state, open(CACHE, "w"))
    except OSError:
        pass
    return sorted(ts(t) for t in set(state["times"]))


def rollouts_since(start):
    """{(repo, ticket): [rollout paths]} for Codex worker threads touched since `start`."""
    out = {}
    root = os.path.join(HOME, ".aiur/accounts/codex/gamebuilder/sessions")
    for f in glob.glob(os.path.join(root, "*/*/*/rollout-*.jsonl")):
        try:
            if datetime.fromtimestamp(os.path.getmtime(f), timezone.utc) < start:
                continue
            head = open(f, "rb").read(4000).decode("utf8", "replace")
        except OSError:
            continue
        m = re.search(r'"cwd":"[^"]*/its-everdred/(open-game-maker|open-games)/(\d+)"', head)
        if m:
            out.setdefault(("core" if m.group(1) == "open-game-maker" else "open-games", m.group(2)), []).append(f)
    return out


USER_LINES = {}


def user_lines(path, start):
    """The user messages of one rollout since `start` (read once per run)."""
    if path not in USER_LINES:
        out, lo = [], start.strftime("%Y-%m-%dT%H:%M:%S")
        try:
            for line in open(path, encoding="utf8", errors="replace"):
                if line.startswith('{"timestamp":"') and line[14:33] >= lo and '"role":"user"' in line[:400]:
                    out.append((line[14:33], line))
        except OSError:
            pass
        USER_LINES[path] = out
    return USER_LINES[path]


def worker_receipt(files, start, after, needles):
    """First user message at or after `after` that carries one of `needles` (the verdict as the worker read it)."""
    best = None
    lo = after.strftime("%Y-%m-%dT%H:%M:%S")
    for f in files:
        for stamp, line in user_lines(f, start):
            if stamp >= lo and any(n in line for n in needles):
                t = ts(line[14:line.index('"', 14)])
                best = t if best is None or t < best else best
                break
    return best


def rework_event(repo, ticket, after):
    inst, name = INSTANCES[repo]
    lo = after.strftime("%Y-%m-%dT%H:%M:%S")
    for f in glob.glob(os.path.join(HOME, ".config/aiur", inst, name, "ticket-events", f"*.{ticket}.events.log")):
        try:
            for line in open(f, errors="replace"):
                if line[:19] >= lo and "label.added.agent.rework" in line:
                    return ts(line.split()[0])
        except OSError:
            pass
    return None


def iterations(start, now, args):
    cmds, by_ticket = load_commands()
    picks = load_picks(args.picks, cmds)
    pubs = [p for p in load_publishes(args.transcript) if p <= now]
    rolls = rollouts_since(start - timedelta(hours=1))
    todo = [(k, p) for k, p in picks.items() if k in cmds and start <= p["first"] <= now]
    relay_gh = {}
    if not args.no_gh and todo:
        keys = {(cmds[k]["repo"], cmds[k]["ticket"]) for k, _ in todo}
        with ThreadPoolExecutor(8) as ex:
            comments = dict(zip(keys, ex.map(lambda rt: gh_comments(*rt), keys)))
        for k, p in todo:
            c = cmds[k]
            relay_gh[k] = next((t for t in comments[(c["repo"], c["ticket"])] if t >= p["first"] - timedelta(seconds=5)), None)
    rows = []
    for k, p in sorted(todo, key=lambda kp: kp[1]["first"]):
        c = cmds[k]
        key = (c["repo"], c["ticket"])
        shown = max((x for x in pubs if c["created"] <= x <= p["first"]), default=None)
        relay = min((t for t in (c["answered"], relay_gh.get(k)) if t and t >= p["first"] - timedelta(seconds=5)), default=None) \
            or rework_event(c["repo"], c["ticket"], p["first"])
        needles = [k] + ([json.dumps(p["note"][:28], ensure_ascii=False)[1:-1]] if len(p["note"]) >= 8 else [f"his words: {p['label']}"])
        got = worker_receipt(rolls.get(key, []), start, p["first"], needles) or \
            (c["delivered"] if c["delivered"] and c["delivered"] >= p["first"] else None)
        nxt = next((x for x in by_ticket[key] if got and got < x["created"] <= now), None)
        asks_change = bool(re.search(r"chang|revis|dislike", p["label"], re.I))
        vis = next((x for x in pubs if nxt and x >= nxt["created"]), None)
        rows.append({"key": k, "ticket": ("" if c["repo"] == "core" else "og") + "#" + c["ticket"], "label": p["label"],
                     "created": c["created"], "shown": shown, "pick": p["first"], "relay": relay, "got": got,
                     "next": nxt["created"] if nxt else None, "visible": vis,
                     "S1": mins(c["created"], shown), "S2": mins(shown, p["first"]),
                     "S3 relay": mins(p["first"], relay), "S4 delivery": mins(relay, got),
                     "S5 work": mins(got, nxt["created"]) if nxt else None,
                     "S6 page wait": mins(nxt["created"], vis) if nxt else None,
                     "loop": mins(p["first"], vis), "open": mins(p["first"], now) if vis is None and asks_change else None})
    return rows, by_ticket, picks


def round_cadence(by_ticket, picks, start, now):
    cadence = {}
    for key, lst in by_ticket.items():
        inwin = [x for x in lst if start <= x["created"] <= now]
        if len(inwin) >= 3:
            gaps = [mins(a["created"], b["created"]) for a, b in zip(inwin, inwin[1:])]
            seen = sum(1 for x in inwin if x["id"] in picks and picks[x["id"]]["first"] <= now)
            cadence[("" if key[0] == "core" else "og") + "#" + key[1]] = (len(inwin), seen, statistics.median(gaps))
    return cadence


def gh_comments(repo, ticket):
    try:
        r = subprocess.run(["gh", "issue", "view", ticket, "-R", GH_REPO[repo], "--json", "comments"],
                           capture_output=True, text=True, timeout=15)
        return sorted(ts(c["createdAt"]) for c in json.loads(r.stdout)["comments"]
                      if re.search(r"review-page verdict|picked on the review page", c["body"]))
    except Exception:
        return []


def fmt(v):
    return "   -" if v is None else f"{v:4.0f}"


def report(hours, now, args, data):
    start = now - timedelta(hours=hours)
    rows = [r for r in data[0] if r["pick"] >= start]
    cadence = round_cadence(data[1], data[2], start, now)
    done = [r for r in rows if r["loop"] is not None]
    waiting = [r for r in rows if r["open"] is not None]
    print(f"Review loop, last {hours:g} h (to {now:%m-%d %H:%MZ}): {len(rows)} verdicts, {len(done)} closed loops, "
          f"{len(waiting)} change requests with no new round on the page yet")
    med = {}
    if done:
        print(f"  {'stage':<14}{'median':>7}{'worst':>7}   (minutes)")
        for s in STAGES:
            vals = [r[s] for r in done if r[s] is not None]
            if vals:
                med[s] = statistics.median(vals)
                print(f"  {s:<14}{med[s]:7.0f}{max(vals):7.0f}")
        loops = [r["loop"] for r in done]
        work = [r["S5 work"] for r in done if r["S5 work"] is not None]
        print(f"  {'LOOP':<14}{statistics.median(loops):7.0f}{max(loops):7.0f}   verdict -> next round on the page")
        share = 100 * sum(work) / sum(loops) if work and sum(loops) else 0
        print(f"  work {share:.0f}% / waiting {100 - share:.0f}% of loop time")
    kev = [r["S2"] for r in rows if r["S2"] is not None]
    pre = [r["S1"] for r in rows if r["S1"] is not None]
    if kev:
        print(f"  outside the loop: S1 raised->page median {statistics.median(pre):.0f} worst {max(pre):.0f}; "
              f"S2 page->Kevin's pick median {statistics.median(kev):.0f} worst {max(kev):.0f}")
    if waiting:
        print("  still open: " + ", ".join(f"{r['ticket']} {r['open']:.0f}m" + ("" if r["got"] else " (worker hasn't got it)")
                                          for r in waiting[-8:]))
    if cadence:
        print("  rounds raised / judged by Kevin / median min between rounds: " +
              "; ".join(f"{t} {n}/{s}/{g:.1f}" for t, (n, s, g) in sorted(cadence.items())))
    if args.rows:
        print(f"  {'ticket':<8}{'verdict':<9}{'S1':>4}{'S2':>5}{'S3':>5}{'S4':>5}{'S5':>5}{'S6':>5}{'loop':>6}  label")
        for r in rows:
            loop = fmt(r["loop"]) if r["open"] is None else f"{r['open']:4.0f}+"
            print(f"  {r['ticket']:<8}{r['pick']:%H:%M:%S} {fmt(r['S1'])} {fmt(r['S2'])} {fmt(r['S3 relay'])} "
                  f"{fmt(r['S4 delivery'])} {fmt(r['S5 work'])} {fmt(r['S6 page wait'])} {loop:>5}  {r['label'][:24]}")
    slow = max(med, key=med.get) if med else "none"
    if done:
        loops = [r["loop"] for r in done]
        print(f"REVIEW_LOOP hours={hours:g} n={len(done)} open={len(waiting)} median_min={statistics.median(loops):.0f} "
              f"worst_min={max(loops):.0f} open_worst_min={max([r['open'] for r in waiting], default=0):.0f} slowest_stage=\"{slow}\" "
              f"slowest_median_min={med.get(slow, 0):.0f} target_median_min=15")
    else:
        worst = max([r["open"] for r in waiting], default=0)
        print(f"REVIEW_LOOP hours={hours:g} n=0 open={len(waiting)} median_min=na worst_min=na open_worst_min={worst:.0f} "
              f"slowest_stage=\"none\" target_median_min=15")


def main():
    ap = argparse.ArgumentParser(description="Review loop metric: verdict -> next round on Kevin's page.")
    ap.add_argument("--hours", type=float, action="append", help="window; repeatable (default: 1 and 24)")
    ap.add_argument("--rows", action="store_true", help="one line per iteration")
    ap.add_argument("--no-gh", action="store_true", help="skip GitHub comment lookups")
    ap.add_argument("--picks", default=newest(f"/tmp/claude-*/{PROJECT}/*/scratchpad/picks-live/picks"))
    ap.add_argument("--transcript", default=newest(os.path.join(HOME, ".claude-2/projects", PROJECT, "*.jsonl")))
    ap.add_argument("--now", help="ISO time to evaluate at (default: now)")
    args = ap.parse_args()
    now = ts(args.now) if args.now else datetime.now(timezone.utc)
    windows = args.hours or [1, 24]
    data = iterations(now - timedelta(hours=max(windows)), now, args)
    for i, h in enumerate(windows):
        if i:
            print()
        report(h, now, args, data)


if __name__ == "__main__":
    main()
