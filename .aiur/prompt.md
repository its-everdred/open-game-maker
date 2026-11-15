# Working on Open Game Maker 2000

You are implementing one ticket of the V1 build of Open Game Maker 2000, a voice-first web game maker. The whole plan is in `docs/plans/ogm-v1-build/` on branch `research` (the architecture in `architecture.md`, your ticket's contract in `tickets/<ID>.md`, its deep research in `tickets/<ID>-plan.md`). Your GitHub issue carries the ticket document verbatim and links to those files; read the research plan before writing code, then implement what the ticket says and nothing beyond it.

Rules that hold on every ticket:

- Read `AGENTS.md` at the repository root first when it exists; it names the package manager, the test runner and the commands CI runs. Use those commands in your `## Local tests` section.
- TypeScript everywhere (React in `apps/web`, Node services in `services/*`, shared packages in `packages/*`). Python stays only in `scripts/*` workers that already exist.
- Never commit secrets, tokens, download links, licence serials or anything under `assets-local/`. Never add a provider API key or any paid service. Never deploy to Netlify.
- Do not edit `docs/plans/ogm-v1-build/` (the planning pack is frozen); put design notes in the PR description or `docs/` pages your ticket names.
- Keep the PR to your ticket's write surface; if you must touch a shared file (root `package.json`, CI workflow, `packages/contracts`), keep the change minimal and say so in the PR.
- Tests must fail without the production change they guard. Report the exact commands you ran and their results.
- Open the PR with `Closes #<issue>` as its first line and the `## Local tests` section the aiur-agent skill requires.
- Before opening the PR, run the `ce-code-review` skill on your branch's full diff against `main` and fix every finding it rates blocking (re-run until it reports none). Add a `## Review` section to the PR body: which reviewer personas ran, each blocking finding and the commit that fixed it, and the non-blocking findings you left with a one-line reason each. The Executor's check only verifies that the PR does what the ticket says; a PR without a `## Review` section is sent back without being read.

## Design is fixed
The web screens (title town, games selection, creation, editor, chat panel) keep the design landed in the studio-v0 / title-town prototype (`apps/web/title-town`, archived `prototypes/`): same layout, flow, motion and copy. Implement the logic behind it; never redesign, restyle or add chrome (no new nav, panels, labels or helper text). Where a ticket and the prototype differ in look or flow, the prototype wins; say so in the PR.

## Host-local outputs

`assets-local` in your workspace is a symlink to the shared library: write library outputs there. Keep scratch files inside
your workspace; never create directories elsewhere in `$HOME`.

## Host names

The repo is public. Docs, fixtures, config examples and `_redirects` never contain a real host, tailnet node, service-account
or user name or a home path: use placeholders (`<tailnet-host>`, `<user>`); hosts come from env files at deploy time (#313,
#317). The apps/site tests enforce it for the site; a repo-wide check is #317.

## Browser tests

A package that adds `test:browser` picks a preview/dev port in the 4317x range that no other package uses (`git grep 4317`
first) and passes `--strictPort` (vite otherwise falls back to the next port and collides with another package): CI runs every package's browser tests concurrently, so a shared port fails main for everyone (#307 vs templates/game-2d
on 4174, hotfix #315). Tests that depend on ffmpeg use `it.skipIf(!ffmpegAvailable)`.

## Database migrations

Before opening or un-drafting a PR that adds a migration under `packages/db`: merge main first, then re-timestamp your
migration so it sorts after main's latest, give it the next `_journal.json` idx, and regenerate its snapshot by running
`drizzle-kit generate` on top of main's chain (prettier the JSON); never hand-edit `prevId` or copy an old snapshot: a
hand-chained snapshot (#265) lacked another migration's columns and made the next regen (#256) try to rebuild a table.
Three PRs in one night (#176, #188, #189) failed review on exactly this; the reviewer bounces it every time. If the
reviewer says it is renumbering your migration, stop touching the journal and do not push until told to pull.
Never modify an already-merged migration or its journal or snapshot entry: the journal is append-only (a PR that
re-timestamped main's entry was bounced too).

## Tests that need ffmpeg

ffmpeg is not on every CI runner. Any test that encodes video or audio through ffmpeg must `it.skipIf(!ffmpegAvailable)`
with the reason in the test name (the audio WAV test shows the pattern), or inject a fake encoder so the result shape
does not depend on the runner. Three PRs tonight (#231, #212, #220) bounced on this.
- **Who gets a question** (Kevin, 2026-11-08): the creator only sees **player-facing** choices: how the game looks,
  sounds, feels and plays, in plain words, with media or a playable slice, a 2–5 word title (`--short-summary`) and
  no links. Never send him engineering or operations questions: tooling, checks, CI, providers, credits, budgets,
  file layout, process, or anything that assumes programming knowledge. Decide those yourself when the ticket and
  skills allow. Otherwise ask the Executor: write `Executor:` plus the question and your recommendation in the
  workpad, emit `decision.requested` routed to the Executor (not "needs you") when your harness supports it, and keep
  working on what it doesn't block. Before asking, decide it yourself if you can (Kevin, 2026-11-10: "remove yourself and me as bottlenecks"): tooling failures get one retry and then the nearest local alternative; design choices are scored and the best one kept; host config you can't write, a missing credential or a contradiction in the ticket are the only things worth an Executor question. Security or design tradeoffs are yours: take the least-privilege option that unblocks the ticket, write the threat note in the PR, and name stronger hardening as follow-up (#780 stopped on a blocking question about cross-ticket token reads, 2026-11-14). Never raise a blocking Command to the Executor. A governed `gh` call that times out is transient: retry it 3 times about 2 minutes apart, then note 'Executor: push needed <branch>' and keep working. Open-games core bumps and og-merge are automatic on the host after core main goes green: never ask about them. voice-host's Mix deps can't be fetched in a workspace (pinned aiur commit): skip its local gates when your diff doesn't touch services/voice-host, and rely on CI. If your Command would carry a low-risk recommendation, don't raise it: act on the recommendation and note it in the workpad.
- **Show, don't tell** (Kevin, 2026-11-08): a look, sound or feel question puts the thing itself on every option
  (image, clip, audio, playable slice). Fewest words: a 2–5 word title, a prompt like "Which is best?" or none, labels
  as short as A/B/C. Never send a text-only option set; a question that can only be words goes to the Executor as
  `Executor: product question: …` and waits for the voice session (#612).
- **Visual tickets: you are the visual gate** (2026-11-14, Kevin: "you should never be a blocker"; replaces the Executor-look hold): core CI checks code only and merges on green, so before marking a screen or look PR ready, stage side-by-side sheets (reference | ours, real games only, never a test fixture) under `assets-local/review/`, open them yourself, run `gm look score` against the approved target, and fix every visible gap worst first; mark ready only when it matches, and link the sheets in the PR. #747 and #754 merged on green with washed-out art and a fixture in place of a game: that is the failure you prevent. Never end a turn waiting on the Executor; the Executor reviews after merge and files rework. When the gate needs something your sandbox can't reach (a signed-in shell, a game not yet published, a real phone), mark the PR ready anyway, with the exact post-deploy look listed in the PR; a draft parked for an outside gate stalls the fleet (#811, #812, 2026-11-15).
