# Open Game Maker 2000

Kevin's voice-first game maker. This repo holds research, the scope, prototypes and the skills Game Maker's agents will
use. Work here the way those agents will work: dogfood the skills.

- **Creator requests** (a scene, a screen, a look): follow `gm-design-loop`, with `gm-assets` (packs first, lineups),
  `gm-asset-variants` (clone, never edit originals) and `gm-verify` (look before sending; MP4 for the phone).
- **No needless text** in what you build: a button whose icon is clear gets no label (put the words in `aria-label`),
  and no taglines, captions or helper sentences unless Kevin asks for them.
- **Scripted edits to JS** (python/sed splices): never put a `//` comment inside a replacement unless the line ends
  there; use `/* */` mid-line. A swallowed tail is still valid syntax, so `node --check` won't catch it (it dropped a
  scene's arguments and an iframe's attributes here); render or run the change before moving on.
- **Scripted waits** (a chain that polls a log for an earlier step): match a terminal marker the step itself writes (`exit=0 <step>`),
  never line adjacency (`grep -A1`); a stray log line between marker and status stalled the tiers render chain for 90 minutes. Waiting on a process: `pgrep -f` matches the waiting shell's own command line, so wait on a pid (`while kill -0 $PID`) instead (a Sonniss retry waited on itself overnight); the same goes for `pkill -f`, which kills the calling shell (2026-11-09): kill by pid.
- **Sprite Forge skills** (`agent-sprite-forge` plugin, project scope in `.claude/settings.json`: generate2dsprite,
  generate2dmap, video2dsprite, generate2dmedia, codeart2d): run their scripts with
  `~/.local/share/ogm/forge-venv/bin/python` (no `python` on PATH). No API key is configured, so `route_media.py` falls
  back to the signed-in Codex CLI; never add a provider key (it counts as consent to spend). Generation is authorised (Kevin, 2026-11-10: "you have my auth to use any skills we have"): workers may generate from Kevin's concept art without asking; mark every output AI-generated in its metadata. Never send paid-pack assets to it as references (no cloud processing of paid assets).
- **Self-improvement:** keep the hourly `meta-improve` listener running (a silent background shell, `scripts/listen.sh`
  in the skill, that wakes the agent only after Kevin has written; start it at the start of a session and again after every context compaction or resume — background shells die with them; check `ps` for listen.sh; no cron). After a login switch (`/switch-login`): stop any duplicate copy of this session still running on the other profile (`pgrep -af 'claude .*--continue|--resume <id>'`; a duplicate holds the Khala identity and breaks `join` with internal_error), rejoin Khala with the saved link, and arm the watch with the profile's own binary and the *current* session id (`~/.claude/plugins/data/khala-khala/npm-*/bin/khala watch --harness claude --session <id from ~/.local/state/khala/claude/*/status.json>`; the `khala` on PATH may belong to the other profile). Lessons persist in skills, scripts and memory; `docs/meta/` is the hourly record.
- **Asset drops:** keep the Drive intake wake-up running too (`scripts/drive-sync/listen.sh <repo>`, same silent-shell
  pattern); when it fires, run `gm-asset-intake` (licence first, then unpack, catalog, preprocess; big preprocessing goes
  to an aiur ticket when the daemon is up, else a background agent).
- **Build at the right layer** (Kevin, 2026-11-11): before filing a ticket or writing a rule, place it.
  - **aiur:** anything any agent-fleet project could use, such as skill and agent analytics, Executor listeners, worker defaults, release pinning. The claude-aiur-fixes session builds these.
  - **This core repo:** anything reusable across games, such as gm CLI, gm-* skills, capture, the asset pipeline and game CI.
  - **Open-Games:** one game or one pack only.

  Generic rules never live only in a game's `.aiur/prompt.md`. Move misplaced work at once. Audit: `docs/meta/layer-audit-2026-11-11.md`.
- **aiur for this repo:** run it with `aiur-main` (`~/.local/bin/aiur-main`: the aiur checkout's own CLI launcher on a copied
  release at `~/.aiur/ogm-release`, built from `~/github/aiur` main), from this checkout, never `scripts/aiurdev` (it targets
  the aiur checkout's own daemon) and never the npm `aiur` (a different fork). Kevin's NUC daemon for aiur-team/aiur runs on
  this host too (instance 5c1b32aea9): never stop or restart it. The OGM daemon is instance e110d74831 on 127.0.0.1:4010.
  Executor state: `~/.aiur/repo/its-everdred/open-game-maker-2000/executor/handoff.md`.
  Repo is `its-everdred/open-game-maker` since 2026-11-02 (public; the old `-2000` name redirects). A rename breaks the daemon's
  tracker writes (agents exit, tickets go `agent:error` "tracker retry exhausted"): fix `.aiur/config` `repo:` at once, then `resume`
  each errored ticket (if "not resumable", drop `agent:error`/`agent:ci-red` with gh and `--todo`). A `dispatch_decline=dependency` is
  GitHub's native blocked-by list (`gh api repos/<r>/issues/<n>/dependencies/blocked_by`), not the body's "Depends on" line; queue the
  open blockers instead of re-`--todo`. A PR whose Actions jobs sit `queued` 30+ min while GitHub says Actions is up (`gh run rerun` refused): close and reopen the PR, which starts a fresh run (#719/#724, 2026-11-11). When Actions is down, `executor/local-ci.sh <pr|main>` replays the workspace job locally (heavy: load hit 50). Open-Games (hosted Actions off for good): `executor/og-merge.sh <pr>` detached runs the local checks and merges on green; its log ends `exit=<n> og-merge <pr>` (a waiter that grepped a guessed marker, `ci-265`, sat 20 min on a finished run, 2026-11-09).
  Every worker's `assets-local` is a symlink to this checkout's `assets-local` (Open-Games has none of its own: put evidence for its workers here). With the Open-Games build queue running, a ticket outside it sits in `build_queue_hold` until `aiur-main --todo <n>`, whatever labels gh set.
  `dispatch_decline=unauthorized` with free slots: read the instance's `*.alerts.ndjson`. `timeline_unreadable` (a busy ticket's GitHub history is over aiur's 512 KB read cap) never clears by `--todo`: until aiur brief 3 lands, file a continuation ticket (same labels, body links the old one), copy `aiur/<old>` to `aiur/<new>`, close the old one (#264→#309, 2026-11-11).
  A worker's ask to the Executor can sit only in its workpad's notes (no "Executor:" comment): read each running ticket's workpad comment every audit (#264 sat blocked on credit metadata, 2026-11-10). App-shell stills of an unpublished PR build: `DIST=<workspace>/games/<game>/dist TAP='Play>Endless>Play' executor/shell-local/run.sh <out>` (`SHELL_PORT=43181` when a worker's copy holds 43179) (`TRACE=1` prints bridge messages).
  Codex workers can write only `assets-local/sets` (and, on Open-Games, `assets-local/review`; plus the `gm` verify slots in `/run/user/<uid>/ogm-verify`) through the workspace symlink: a ticket that writes elsewhere in the library needs its folder added to `writableRoots` in `.aiur/config` when it is filed (#686).
  A worker in `agent:human-review` whose workpad says the branch is pushed but governed `gh pr create` timed out: open the PR by
  hand from its branch (body from the workpad), relabel `agent:ci-wait`, report the timeout to Aiur. GitHub's merge queue is not
  available on this user-owned repo (ruleset 26376924 = PR + green `required`, non-strict; merge on green without update-branch).
  Pausing a running worker: `aiur-main pause <id>` / `resume <id>` / `park <id>` (park needs pause first; a ticket whose open draft PR is its handoff gets pause+park until aiur #7970 lets drafts enter human-review, else it loops no-change turns) (or the `agent:paused` label, which frees its slot); `message` does not stop it (#211 opened a PR after being told to stop). A ticket with an open PR sits in ci-wait and takes no turn: hold or close the PR, then `--todo`. Prove skill injection from the new session's first prompt (`Mapped skills (load first)`), excluding the old session file.
  Creator Commands raised non-blocking expire 5 min after their ticket stops running (aiur `decision_expiry.ex`, aiur #7872; workaround: raise them `--blocking`): until it lands, ask Kevin in chat too and re-raise his unanswered picks while the ticket runs. Headless `claude -p` on the second login (`~/.claude-2`) hangs on its plugins: add `--setting-sources project --strict-mcp-config --no-session-persistence` (see `executor/mock-broker.py` look()).
  An `executor-answer` can sit `dispatch_pending` and never reach the worker (it exits or re-asks; #264 twice, 2026-11-09): after each one, read `aiur-main commands <id>`; if not delivered, comment the answer on the ticket, `message` it, moot any duplicate Command (`resolved_elsewhere`) and `--todo` a stale or orphaned claim. Host-only steps (the og-local-ci runner, blob-store registration) are the Executor's: workers stage files in `assets-local/review/` and write the command; I run it.
  A multi-question Command (`3 questions: …`) can't be answered from the CLI (`question_answers :incomplete`): post the answers as a ticket comment plus `aiur-main message <ticket>`, then `executor-moot <id> --expected-version 1 --reason-class resolved_elsewhere`.
  Dusk Helm hold: its root open-games #2 carries `agent:paused` with `agent:queued` removed (every other Dusk Helm ticket is blocked by it); each audit, check that no `game:dusk-helm` ticket is running.
  Idle fleet (`AGENTS 0/N`) is never "nothing to do": list `agent:queued` tickets on both repos and find why each isn't running (no `agent:todo`, `agent:error`, an open blocker, a merged PR on a still-open ticket), then fix it (Kevin, 2026-11-09: "why no new work?" after three idle hours).
  Every audit: `executor/aiur-keep-current.sh` (Kevin, 2026-11-10: always run aiur at latest main; it starts a background build when main moved, then swap per `executor/aiur-release-swap.md`, both daemons `--keep-agents`, never during og-local-ci). To run an unmerged aiur fix, write its full sha to `executor/.aiur-pin` before swapping: auto-update and keep-current then keep that build until main contains it (without the pin, auto-update rebuilt main and swapped the probe fix back out, 2026-11-11).
  Every audit: `executor/stack-health.sh` (silent when healthy: the four stack ports, the auto-update loop and its DOWN/FAILED lines, repeating
  errors in `~/ogm-stack.api.log`). The API sat down for 5 h on 2026-11-09 with "DOWN after restart" in a log no check read: `tsc -b` leaves the
  output of a renamed source in `dist/` and the API imports every route file there, so `executor/prune-stale-dist.sh` now runs before each restart.
  A game daemon the app reads needs `events.export.enabled: true` in its `.aiur/config` (restart to apply; without it the feed token route is 404).
  Every audit: `aiur-main commands --filter open`; a worker's "Needs you" question idles its ticket until Kevin answers, and the
  CLI refuses an Executor answer, so relay Kevin's standing words with `operator-relay-answer <id> --expected-version 1 --option
  <id> --quote "<his words>" --relayed-by nuc-ogm-executor --idempotency-key <k>` (three QA-path workers sat 40–75 min on 2026-11-02).
  When the host is saturated (load > ~80, PSI > 90, RPCs time out), lower `max_concurrent_agents` in `.aiur/config` (hot-reload)
  instead of `set max-agents` (the RPC times out too); restore it when load drops.
  Config changes hot-reload: the daemon watches `.aiur/config` and applies it within a second without dropping agent turns
  (back the file up first; use only keys the running build knows; `aiur-main status` shows `CONFIG RELOAD REJECTED` on a
  bad file). Never stop/relaunch the daemon for a config change.
  After a Codex weekly reset the usage meter stays stale (it refreshes only at boot or in a Codex session) and keeps dispatch off
  Codex: `aiur-main restart --keep-agents --no-build` on both instances, not while an `og-local-ci.sh` run is in flight (the restart
  killed one, exit 143), then for any ticket left `orphaned_claim` (adopted workers can drop to it minutes later; check again after 5 min) remove `agent:in-progress` with gh and `--todo` it (`--todo` alone keeps the claim); if it then sits `awaiting-dispatch` with reason `:unknown`, one more restart frees it, or `aiur-main reset-budget <n>` when it says `latched_lifetime` (80 dispatches; restart churn trips it); a re-dispatched workspace can come back without `node_modules` and workers can't install (EROFS): run `pnpm install --frozen-lockfile` in `~/.aiur/w/its-everdred/<repo>/<n>` on the host (#264/#285/#286, 2026-11-10); `redispatch <id> --backend codex` moves a worker off Claude.
  Codex workers take model and effort from `~/.aiur/accounts/codex/gamebuilder/config.toml` (not `~/.codex`, not the daemon): `gpt-6.1-terra` at `medium` since 2026-11-09 (Kevin, token burn). A resumed thread and its sub-agents keep the model and effort they started with (rollout `turn_context`; aiur #7947), and `redispatch`, `pause`/`resume` and a daemon restart all resume the stored thread. To move a live worker: have it push a checkpoint, then `executor/fresh-thread.sh <core|og> <ticket>` (drops the thread from the ticket's handle in `~/.config/aiur/<instance>/<repo>/session-handles/`, redispatches, prints the new thread's model; ends `exit=<n> fresh-thread <ticket>`). Prove a switch from the new main rollout, never from the config file (the first `redispatch` of #693/#271 kept gpt-5.6-sol/xhigh, 2026-11-09).
  Throughput gate: when `AGENTS` shows `binding: AIMD envelope` below the cap while CPU PSI is under target, `aiur-main set
  max-agents <cap>` (the same value) resets a *held* envelope within a minute (fleet 6→12 on 2026-11-01); while `AGENTS`
  says `resuming toward N (safe level)` it is already ramping and the reset does nothing, wait it out. Lowering the PSI
  thresholds is not the lever: at 55/70 the fleet fell 10→6 and PSI stayed ~88 % (the daemon BEAM itself uses ~2 cores,
  Aiur #7468). Wrap RPCs that must land in `executor/retry.sh <args>` (3 tries on timeout); `executor/status.sh` prints the
  build progress line for ETA questions.
  Review loop (Kevin, 2026-11-01 06:20: "way too many Claude tokens"): the deep review is the worker's own `ce-code-review`
  run before the PR (`.aiur/prompt.md`, AGENTS.md); the Executor's background check is the light brief in
  `docs/plans/ogm-v1-build/review-brief.md` (does the PR do the ticket, scope, evidence, secrets) on `model: haiku`,
  no mutation runs, no gate rebuilds; post reviews as comments (`gh pr review --comment`, with explicit `Blocking:` lines) and then send the same asks into the running worker with `aiur-main message <ticket> "…"` (comments never reach a worker mid-turn; Aiur, 2026-11-01, #7459; `message` to a *paused* worker is refused with "max concurrent agents reached", so for a paused worker leave the note as an issue comment instead, which it reads on resume; a worker in `agent:ci-wait` with green CI takes no turn at all, so a review on its PR sits unread until the Executor re-queues it with `aiur-main --todo <ticket>` (`resume` is refused in ci-wait); aiur #7407 fixes this once aiur-main is rebuilt; while the fleet is gated, give workers that owe PR fixes `priority:1` so they take the next slot ahead of fresh tickets), because the
  single-identity install makes self-approval impossible; merge with `gh pr merge --merge` after a green `ci / required`
  (`aiur pr merge` fails here: "unexpected tool failure"); wait on checks with `gh pr checks <n> --watch --fail-fast` (this gh 2.46 has no `--json` for checks).
- **Branch and safety:** commit research to `research` as you go; never commit `assets-local/`, keys, download links or
  serials. Origin is an SSH URL with no key here: push over HTTPS with gh credentials,
  `git -C <repo> -c credential.helper='!gh auth git-credential' push "$(git -C <repo> remote get-url origin | sed 's#git@github.com:#https://github.com/#')" research`
  (one commit at a time if it disconnects). Deploy the prototype (`prototypes/studio-v0/tools/deploy.sh`) only when Kevin says so; Netlify credits
  are limited.
