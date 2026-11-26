---
name: gm
description: Run Open Game Maker's agent fleet as its Executor. The OGM layer over aiur-run: two daemons, build queues, systems as epics and features, Kevin's review loop, host steps, deploy caps and host protection. Use for "/gm", "run OGM", "operate the fleet", at session start, and after every context compaction or resume (re-read it before acting).
---

# gm: the OGM Executor

**Load `aiur-run` first** (`~/.claude/skills/aiur-run/SKILL.md` plus the references it names). This skill adds only what is specific to OGM. When the two disagree, aiur-run wins on how aiur works, and this skill wins on OGM policy. Detail lives in the repo's `CLAUDE.md`; this page is the checklist that keeps a fresh context from drifting.

## On load (every session, compaction and resume)
1. Read `CLAUDE.md`, `docs/layers.md`, the newest `docs/meta/<date>/*.md`, and `~/.aiur/repo/its-everdred/open-game-maker-2000/executor/handoff.md`.
2. Restart the background loops the compaction killed:
   - the meta-improve listener (`MI_ALWAYS=1 …/listen.sh <repo>`);
   - the Khala watch (the 0.4.17 binary);
   - the review-page relay agent.
3. Run `executor/quick-check.sh`. Then run `aiur-main queue show` in **both** repos.

## Daemons
| Repo | Instance | Checkout |
|---|---|---|
| core (its-everdred/open-game-maker) | e110d74831 | `~/games/open-game-maker-2000` |
| games (its-everdred/open-games) | 940a3884be | `~/games/open-games` |

- Run `aiur-main` from the matching checkout.
- Never touch Kevin's 5c1b32aea9.
- aiur repo work belongs to the PC aiur session (tmux `pc-aiur` on everdred@100.89.62.105). Deliver to it over Khala AND by `tmux send-keys … Enter`, then press Enter again if the text was pasted, and read the pane to confirm it was sent.

## Ordering work: build queues, never slot juggling
- **Priorities live in aiur build queues** (`aiur queue …`, `build_queue.set_order: ranked`). Labels alone don't order work. Pausing or parking running tickets to free a slot for a P0 is a fallback that needs a logged reason.
- **New or urgent work:**
  1. Read `queue show` and note the previous next-up.
  2. `queue add <ids…> --queue <name> --rank <pos>` (or `--at`).
  3. `queue reorder` / `queue order <name> --to <pos>`.
  4. Read it back and report "<new> now precedes <previous next-up>".
- **Stale lists** (old phases fully held) get cleared or re-ordered when a new priority set arrives.
- **Lists start serially by default:** `start on pr_merged` makes each item wait for the previous item's merge, which idled the games fleet at 0/4 on 2026-11-26. Create lists with `--start-on pr_opened`, or fix them with `queue set <name> --start-on pr_opened` (positional name; `--queue` is refused for `set`).
- **Scripted loops of `aiur-main` must use `</dev/null`,** or the first call eats the rest of a heredoc.
- **If queue writes fail** (an allowlist or authorization error): report it to the PC aiur session with the exact error, record the blocker in the handoff, and only then fall back to `--todo` plus pause/park.

## Planning shape (core #1399)
- Every game is planned as **systems**. Each system is:
  - a GitHub epic issue (`epic` label + native sub-issues);
  - an aiur feature under the game's aiur epic (`bo-<root>`), with one lane per stream (`feature create … --lane`, `epic add`, `feature add … --lane`);
  - a queue position.
- Streams mock separately and converge in one named "<system> prototype" child.
- **Before filing:** search open and closed work in that feature (`gm work search` once it exists). Extend existing work; don't duplicate it (Kevin, 2026-11-26: "duplicate work is worse" than duplicate questions).
- **Kevin's standing preferences** go in the core `preferences/` registry (#1395), never only in memory.

## Kevin's review loop (the product)
- Every Kevin-facing round becomes a card on the review page `J677BXMrKJq59bngg11n2i`. The relay agent delivers his picks within 15 minutes; never stop its timer.
- End every reply with the page link and the open count when questions are open.
- Titles are plain words, never bare ticket numbers.

## Host steps and protection
- **Visual looks:** `executor/host-steps.done` (`judged:<pr>@<sha>`) / `host-steps.looked-back` (`rejected:…`). Look at the stills first.
- **Merges and publishes:** `og-batch` / `og-merge` / `og-publish`. Game publishes are unlimited. Netlify deploys are at most one per hour each (app, site), and none 23:00–05:00 Pacific (`executor/quiet-hours.sh`).
- **Heavy jobs** go in `ogm-heavy.slice`.
- **Zomboid must keep running.** If load stays above about 80 or RPCs time out, lower `max_concurrent_agents` in `.aiur/config`, which hot-reloads.
- **Never delete** without Kevin's OK, and never `commit -a`.

## Hourly pass
Run `meta-improve`. Each pass:
- measures the review loop;
- checks prod freshness and repeated `qa-game-play` failures (a repeat is P0);
- checks the queue order and agrees with Kevin's latest priorities;
- reads a sample of worker logs;
- confirms every fix this hour has an owner ticket.
