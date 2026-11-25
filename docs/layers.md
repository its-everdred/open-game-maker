# Layers: aiur, OGM, OGS

Three products, each with its own repo, config and owner. Put every change in the lowest layer that serves all its users:

- **aiur:** for any agent-fleet project.
- **OGM:** for any game.
- **OGS:** for one game or pack.

The Executor's host glue sits beside them and is temporary by design.

The hourly meta pass keeps this file current (CLAUDE.md, "Build at the right layer"). Last reviewed 2026-11-20.

## Where does it go?

1. Would a non-game project using aiur want it? Then it's **aiur**. Examples: ticket lifecycle, Commands, dispatch, per-turn effort, worker sandbox, skill mapping, review/"Needs you" UI, CI failure → rework.
2. Would a second game want it? Then it's **OGM core**. Examples: SDK, `gm` CLI and its gates, the app (tiles, selected-game view, Review screen), publish, `gm-*` skills, multiplayer pause, the trailer and thumbnail rules.
3. Only this game or pack? Then it's **OGS**. Examples: Blobs layout, its art, its trailer, its cast's quotes.
4. A host script or Executor habit? Then it's a stopgap. Note the layer it belongs in, and file it there (the "Open moves" list below).

Fix the cause at its layer, and work around it at a lower layer only with an owner ticket. Examples from 2026-11-17:
- **aiur:** a reworked ticket ignored its blocked-by. Fixed in aiur's runner, not by pausing by hand.
- **OGM:** a gate that broke Blobs capture was fixed in `gm look`. Blobs then added its own marker.

## aiur: the agent fleet

| Context | Where |
|---|---|
| Code | `aiur-team/aiur`, checkout `~/github/aiur`. Changed only by the **aiur session** (tmux `claude-aiur-fixes`). Reach it with `executor/tell-aiur.sh "<bug + evidence + fix wanted>"`; replies land in the listener file. |
| What runs here | Release at `~/.aiur/ogm-release`, built from the commit in `executor/.aiur-pin`, run through `~/.local/bin/aiur-main`. Swap per `executor/aiur-release-swap.md`: check the stamp, never during og-local-ci, use `--keep-agents`. |
| Daemons | OGM core `e110d74831` (127.0.0.1:4010) and Open-Games `940a3884be`. Kevin's NUC daemon `5c1b32aea9` is never touched. |
| It owns | Tickets and `agent:*` labels; Commands (creator decisions, `require_option_media`, supersede; the transport for inventory decisions and prototype reviews, whose content is core's and the game's); dispatch, AIMD and caps; native blocked-by; per-turn effort from `model:<effort>` labels; rework on CI failure; skill injection from `skills.by_label` / `by_lane`; the worker sandbox; the dashboard "Needs you" UI. |
| Worker model and env | `~/.aiur/accounts/codex/gamebuilder/config.toml`: model, default effort, `[shell_environment_policy.set]` (impeccable no-tracking env). |
| Not here | Anything game-specific. Project rules live in each repo's `.aiur/` files (below), which aiur reads but the project owns. |

## OGM: Open Game Maker core

| Context | Where |
|---|---|
| Repo | `its-everdred/open-game-maker`. This checkout, `~/games/open-game-maker-2000`, holds research, docs and CLAUDE.md on branch `research`. `~/ogm-stack` is main, and it's what runs. |
| What it holds | `apps/web` (the app: home grid, selected-game view, Review screen); `services/` (api, games-host, rooms, commit); `packages/` (sdk, `gm-cli`: look/check/trailer/publish/preview gates, contracts, aiur-client); `skills/` (`gm-*`, `gm-prototype`, `vendor/` third-party such as frontend-design and impeccable); the game repo template. |
| Worker config | `.aiur/config` (`skills.by_lane`, `by_label` with `phase:*` → gm-prototype), `.aiur/prompt.md` (worker rules for core: gate changes run against the live Blobs dist), `.aiur/hooks`. |
| CI, merge, deploy | Hosted Actions with a required check; the Executor merges on green with `gh pr merge --merge`. `executor/auto-update.sh` moves `~/ogm-stack` to main, restarts services, and deploys web at most once an hour. Marketing site: Netlify `makeopen-site` at makeopen.games, deployed by hand via `apps/site/tools/deploy.sh`. App: Netlify `ogm2000` at weaver.makeopen.games (`OGM_APP_ALIAS_ORIGINS` in `~/.config/ogm/env/web.env` no longer lists the apex). |
| Tickets | its-everdred/open-game-maker issues. File with `executor/file-ticket.sh ~/games/open-game-maker-2000 …`. |
| Decision inventory and prototype review (rules, tools) | The contract is `skills/gm-core/references/decision-inventory.md`; `gm-new-game-plan` and `gm-scope-options` write the inventory, `gm-core` and `gm-prototype` raise its decisions, `gm-verify` and `gm-qa` require the prototype review (PR #1054). Enforcement in tools: #1055 (`gm decisions` + `gm check`/`gm plan check`/publish gates), #1056 (New Game opens on the first review queue), #1057 (every publish posts the build's prototype review). The queue UI is #843. |
| Skills reach workers | Core workers read `skills/` from their repo clone. OGS workers get a copy of `~/ogm-stack/skills` (`executor/materialize-workspace.sh`). A new skill reaches OGS only after auto-update moves the stack. |

## OGS: Open Games Weaver

Assumed: the `open-games` repo plus the hosted site.

| Context | Where |
|---|---|
| Repo | `its-everdred/open-games`, checkout `~/games/open-games` (auto-update leaves it on `executor/core-bump`; never publish from it by hand). Worker workspaces: `~/.aiur/w/its-everdred/open-games/<ticket>`. |
| What it holds | `games/<slug>/` (Blobs: `src/`, `design/` targets and flow, `review/` tracks, `public/media/` thumbnail, loading and trailer art), and `vendor/core` (the pinned core, bumped by auto-update). |
| Worker config | `~/games/open-games/.aiur/{config,prompt.md,hooks}` (local, untracked). `by_label` maps `role:*`, `game:blobs`, `phase:*`. `prompt.md` holds Blobs rules: board never covered, compare before shipping, review stays on the ticket. |
| CI, merge, publish | Hosted Actions are off. `executor/host-steps.sh` og-merges ready PRs with local CI, and holds visual PRs until all four in-game stills of the head exist. `og-publish.sh` publishes to `https://weaver.makeopen.games/play/<slug>`. |
| Stills and review | host-steps takes app-shell stills (`assets-local/review/blobs/<n>-auto/<head>/`) for workpad asks. Kevin reviews on artifact pick pages and the combined queue (until core #843). His verdicts reach workers through `operator-relay-answer` plus rework. |
| Decision inventory and prototype review (data) | Per game: `docs/<slug>/decisions.json` + `decisions.md` in the open-games repo (Dusk Helm first), `## Creator decisions` ids on each game ticket, a `## Prototype review` section in each playable PR. Games supply only this data; the rules and tools are core's. `.aiur/prompt.md` repeats the three worker rules in short form. |
| Tickets | its-everdred/open-games issues, labelled `game:blobs`, `role:*`, `phase:*`, `model:*`. Creator requests file at `phase:mock model:low`. |

## Executor host glue (temporary)

**PC Executor** (Kevin's PC, `ssh everdred@100.89.62.105`; Khala channel GM as "PC"): runs core no-asset tickets under `tracker.github.label_prefix: pc` (hand over: drop `agent:*`, add `pc:queued` + `pc:todo`, post "PC takes #N"), plus aiur-team/aiur (prefix `agent`; Kevin's NUC aiur daemon 5c1b32aea9 stays off while it runs), aiur-team/archon and Kevin's other repos. No game work (Kevin 2026-11-22 ~05:15Z, reversing that morning's PC open-games daemon, which is now retired; its config stays in `~/github/everdred/open-games/.aiur/` unused). When the PC is off and its tickets block the NUC, they move to the NUC (`agent:*`). `executor/pc-rework.sh` remains for core `pc:*` tickets.

This directory: `~/.aiur/repo/its-everdred/open-game-maker-2000/executor/` (scripts) and `executor/handoff.md` (state). Run them from there.

- **Loops:** `host-steps.sh` (merge, publish, stills, audits, follow-up triage), `auto-update.sh` (stack, web deploy, aiur pin), `command-listener.sh` (wakes the Executor).
- **Helpers:** `file-ticket.sh`, `pick-page.sh`, `tell-aiur.sh`, `og-merge.sh`, `og-publish.sh`, `decide.sh` (Executor pick decisions: comment + rework; `pc:*` tickets via `pc-rework.sh`), `og-cpu-split.sh` (70/30 cgroup split), `og-dispatch-watchdog.sh` (restart a stalled open-games dispatch; both run from host-steps).
- **Mock broker:** `mock-broker.py` (one copy, flock) generates workers' image mocks; references may come from `assets-local/packs/` whose rights include `style-reference` (refused otherwise, 2026-11-24), `sets/` and `review/` so mocks match the real kit (Kevin 2026-11-19); the rest of the private library is refused.
- **Humble watch:** systemd user `ogm-humble-watch.timer` (every 3 h, random delay) runs `~/.local/bin/humble-watch.py` on the public humblebundle.com/bundles page; new bundles go to the scratchpad `aiur-replies.md` (`humble-new:`), review cards `scratchpad-cards/humble.jsonl` (images in `assets-local/review/humble/`) and, relevant ones, `~/.local/state/ogm/humble-watch/notify.txt` (state `seen.json`).
- **Kevin's personal skills** (not workers' unless vendored): `its-everdred/skills`, where `external-skills.json` installs into `~/.agents/skills`.

**Open moves** (host glue that belongs in a layer; from `docs/meta/layer-audit-2026-11-11.md` and later):

| Glue | Belongs in |
|---|---|
| command-listener | aiur Executor wake on new Commands |
| release pin, build and swap | `aiur upgrade --pin` |
| fresh-thread, retry | aiur |
| host-steps stills, merge gate and audit loop | aiur (generic host steps) plus core (`gm` capture) |
| pick pages and the review queue | core #843 (app) and aiur (dashboard review) |
| Executor raising a prototype review by hand after a publish; `REVIEW_QUEUE` counts in `scripts/meta/review-loop-metric.py` | core #1057 (post-publish review) and #1055 (`gm decisions`, counts from the API) |
| decide.sh (decision delivery as rework) | aiur: an Executor decision on a Command should resume the worker |
| mock broker reference policy | core gm-image-mock / a core mock service |
