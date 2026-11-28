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
   - the review-page relay agent. It must ALWAYS be running (Kevin 2026-11-26: "always keep it on"); restart it after any interrupt as well.
3. Run `executor/quick-check.sh`. Then run `aiur-main queue show` in **both** repos.

## Daemons
| Repo | Instance | Checkout |
|---|---|---|
| core (its-everdred/open-game-maker) | e110d74831 | `~/games/open-game-maker-2000` |
| games (its-everdred/open-games) | 940a3884be | `~/games/open-games` |

- Run `aiur-main` from the matching checkout.
- Never touch Kevin's 5c1b32aea9.
- **Route new scope the moment it arrives** (Kevin 11-27: "you are my source of truth … delegating to PC any time new scope arrives that it should own"). PC lanes: pack renders, GIFs and trailers (cards to `assets-local/review/pack-renders/`), pack capture, all aiur work, Khala, and spare core tickets on its `pc:*` daemon. The PC merges what it owns (visual and UX looks carded first). Send over Khala AND tmux in the same turn, then tell Kevin. Moving a ticket to the PC: strip EVERY agent:* label and add pc:queued plus pc:todo; a leftover agent:done makes the PC daemon skip it and delete its workspace (11-27, #1087, aiur#8191).
- aiur repo work belongs to the PC aiur session (tmux `pc-aiur` on everdred@100.89.62.105). Deliver to it over Khala AND by `tmux send-keys … Enter`, then press Enter again if the text was pasted, and read the pane to confirm it was sent.

## aiur upgrades
Only aiur main runs on the NUC: fixes reach us by ticket → branch → PR → merge queue → upgrade. Never cherry-pick onto the release, run a local branch, or pin unmerged code (11-27: 78 off-main commits). An `ALARM` from `aiur-keep-current.sh` (printed once per off-main build) is P0.

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
- **Pin a ticket to Claude** (e.g. when Codex refuses its content) with the `model:claude` label plus `--todo`; `redispatch --backend` needs a live worker.
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
- End EVERY reply to Kevin (short status lines too) with the page link and the open count while any card is unreviewed, not only when a new card was added (Kevin 11-27).
- Titles are plain words, never bare ticket numbers.

## Host steps and protection
- **Use the design's code, never re-draw it** (Kevin 11-27: "can't they just use the code?"). UI work imports prototypes/ogm-glass CSS, tokens and markup; raw hex or rgba in app CSS is a defect to send back, and so is any element or effect the artboard lacks (11-27: a Read-aloud button and gradient bubbles were invented).
- **Approved designs are replicated exactly** (Kevin 2026-11-26: "i care about replicating even the smallest details"). A redesign PR needs the `gm design parity` report (#1449): artboard renders vs app screenshots, strict thresholds, token/component lint. Reject any visible deviation in the side-by-side even when the score passes.
- **Core auto-merge sweep** (`executor/automerge.sh`, every 3 min) merges green aiur/* core PRs, except pc:* tickets (the PC merges those) and PRs labelled `hold-for-look`. Label any visual PR before Kevin's card (11-27: it merged the churchyard before his look).
- **Visual looks:** `executor/host-steps.done` (`judged:<pr>@<sha>`) / `host-steps.looked-back` (`rejected:…`). Look at the stills first.
- **Merges and publishes:** `og-batch` / `og-merge` / `og-publish`. Game publishes are unlimited. Netlify deploys are at most one per hour each (app, site), and none 23:00–05:00 Pacific (`executor/quiet-hours.sh`).
- **Heavy jobs** go in `ogm-heavy.slice`.
- **Zomboid must keep running.** If load stays above about 80 or RPCs time out, lower `max_concurrent_agents` in `.aiur/config`, which hot-reloads.
- **Never delete** without Kevin's OK, and never `commit -a`.

## Root causes, not symptoms
Kevin 2026-11-27: "treating symptoms is a very common problem". Every recovery (relabel, requeue, reset-budget, park, restart, fresh-thread) is paired in the same turn with its named root cause and a fix or a filed owner issue (aiur → the PC aiur agent over Khala; our scripts → fix them). A second occurrence means file it now, with the count. Reports lead with the root cause and owner.

## Hourly pass
Run `meta-improve`. **First run `scripts/meta/host-pipeline-health.sh`** (capture failures, repeated host-step failures, quiet loops, orphan servers, waiting media, unread HS_ATTENTION lines, repeat errors) and act on every line that pass. Kevin 11-27: the pass is "to review the full current state of work" and "to ensure nothing falls through the cracks"; 25 rounds lost their stills for 3 days and 471 attention lines went unread while passes only logged what I did. Each pass:
- measures the review loop;
- checks prod freshness and repeated `qa-game-play` failures (a repeat is P0);
- checks the queue order and agrees with Kevin's latest priorities;
- reads a sample of worker logs;
- confirms every fix this hour has an owner ticket.
