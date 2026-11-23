# `gm` command reference

`gm` is the offline-safe command line used inside Game Maker repositories. Run `gm help` for the installed command
list and `gm help <command>` for flags.

## Initialize an instance repository

```text
gm instance init <dir>
```

The destination must be empty. The command creates one pnpm workspace with `games/*` and `packages/*`, root scripts,
asset-reference-only ignore rules, and CI that typechecks, tests, and builds the packages changed by a pull request.

## Add a game

```text
gm new <game-2d|game-3d|game-multiplayer> <slug> [--family <id>] [--set <id>] [--pov <id>]
```

Run the command inside an initialized instance repository. It creates `games/<slug>/`, gives the game a unique
`@game/<slug>` workspace package name, copies the scaffold-only engine template, records the creation choices in
`gm.lock.json` and writes `AGENTS.md`. Skills are supplied by the platform to workers. It does not install
packages or add game entities. Install afterward from the instance repository with `pnpm install --offline`; that
refreshes the instance `pnpm-lock.yaml`, so commit the result because CI installs with `--frozen-lockfile`.

`--family` must name a family id from `packages/asset-cards/data/style-families.json`, the registry `gm assets search`
reads. A set id (for example `limezu-modern`) is refused with its family named; sets stay nested under their family.
`--set` must name a set in that registry and, when `--family` is present, belong to the chosen family. It records the
set in `gm.lock.json` and pins the exact `@gm/pack-<set>` version.

## Prune failed game creates

```text
gm admin games prune-failed [--dry-run | --prune] [--api <url>]
```

Lists games whose latest commit audit records a refused or failed `create_game` before a repository could be resolved,
with no repository metadata or release. The default is a dry run; `--dry-run` makes that explicit. Pass `--prune` to
remove only those audited rows. The command uses the host's `OGM_INTERNAL_TOKEN` and
`OGM_API_PORT` from `api.env`; `--api` can select a loopback API explicitly.

## Preview an unmerged build

```text
gm preview [--ticket <number>] [--branch <id>] [--json]
```

From the game folder (or a sparse workspace with one game), build the current workspace, including uncommitted edits,
and send it to the game's review queue without changing the live build. The ticket defaults to the current agent ticket
or `aiur/<number>` branch; pass `--ticket` when neither is available. Worker preview uploads use a short-lived, ticket-and-game-scoped credential and the host relay; see the `gm-verify` skill for daemon hook setup. On the daemon host, `OGM_INTERNAL_URL` and
`OGM_HOOK_SECRET_FILE` provide the upload connection. A new upload for the same game and ticket replaces the review
request; the creator's verdict and optional note go back to that ticket. The game branch defaults to `main`; pass
`--branch <id>` for another game branch so the editor shows the preview on the correct version.

## Post a review round

```text
gm review post <submission.json>
```

In a configured worker workspace, the submission uses that ticket's scoped relay credential.

Host merge tools can call `gm review close-check <game> <ticket> <sha>` before closing a ticket. It exits successfully
only when the API confirms that the ticket's review phases permit closure; missing configuration and API errors refuse it.

A review Command can also be tied to the round with `gm decide --key <round-id>` and the explicit option IDs
`approved`, `needs_work`, and `kill`. Only the game owner's answer is applied to the round.

The JSON carries a stable UUID `id` (reuse it when retrying), the `track`, `phase`, `category` (`art`, `gameplay`,
or `sound`), owning `ticket`, commit `sha`, optional `prNumber`, and `media` array. Track definitions live in the
committed game directory at `review/tracks/<track>.json`, with the track `id`, `category`, and an ordered `phases` array.
Each phase has an `id` and literal `template`; the first can specify its existing `ticket`. The API records the owner
of later phases when approval creates their tickets. Gameplay submissions need
a `build` reference from `gm preview` and a `question`. Every `build` item names the `scenario` it reviews, one of
the game's `GameModule.scenarios`; `gm review post` refuses a build item without one, because the review card plays the
build from that moment. Sound submissions after mock need a `clip` reference to a
stored MP4 containing video and audio, with `hasAudio: true`; sound mocks can also use an audio file. Art stills and clips use stored
blob hashes as `ref`; media entries use `kind` and `ref`.
To compare against a concept, include one still with `role: "target"` alongside the submitted work. The review shows
the target and work side by side.

## Publish a game

```text
gm publish <slug> [--sha <ref>] [--checkout <path>] [--api <url>]
```

After a successful publish, `gm publish` checks merged PRs since the last reviewed build and posts one prototype review
for creator-visible changes. It captures the hosted build with `gm qa playtest --all-modes`; when capture fails, it
posts any stills that were produced and marks the clip unchecked. A missing `## Prototype review` section posts the
play link with “Limitations not stated” and reports the merged PRs that need review notes. If every PR says
`Prototype review: none`, no round is posted. The review links to the published build and carries current works,
limitations and eligible decision ids. When the merged PRs' Play links name a `scenario=`, the latest one rides on the
build, and the review card embeds that slice (`/g/<gameId>/play?build=<buildId>&scenario=<name>`) to play in place.

The publish host's `api.env` supplies `OGM_GAMES_ORIGIN` so the review link opens the exact published build. Set
`OGM_PUBLISH_BUILD_TIMEOUT_MS` in that file to change the production build deadline in milliseconds; it defaults to
1,800,000 (30 minutes). A timed-out build reports its deadline directly and is not reported as missing `dist/` output.

The post-publish check runs through `ops/bin/ogm-qa-review-hook`; it also plays the published game in the production
shell with `gm qa play-check <game id> <build id> --out <dir>` (first frame, first tap path, one input; see the ops
runbook), after `gm qa frame-check <frame url> --app <origin>...` frames that build in WebKit on every app domain. For a direct check, use
`gm qa publish-review-check <slug> <build-id>`; `gm qa publish-review-check --all` lists any published builds still
waiting for a round. The host timer runs the sweep every ten minutes and records gaps in the configured QA attention file.

## Verify a game

Measure the second games-list load in a phone-sized browser with the QA account. The command reports the named game's
logo and thumbnail URLs, HTTP status, transferred bytes, duration, response `Cache-Control`, and the games-list API
duration. A zero transfer size means no network bytes were transferred; Chromium does not identify whether the source
was memory or disk cache. The default game is `blobs`. `--origin` must match the app origin configured for the QA host.
After a no-op `gm publish`, pass its build ID with `--after-publish`; the command loads that build and its predecessor
in one browser context, totals bytes transferred for the game's files, and fails if a file other than the build
manifest or `index.html` changed URL, or if an unchanged URL transferred bytes. This mode also needs
`OGM_GAMES_ORIGIN` in the QA host's `api.env`.

```text
gm qa games-cache [--origin <app origin>] [--game <slug>] [--after-publish <buildId>] [--json]
```

```text
gm check [--body <file>] [--base <ref>] [--lane <creative|clone>] [--phase mock|prototype|build|polish] [--json]
gm check static [--json]
gm check hooks [--json]
gm check images [--json]
gm images compose
gm check boot [--dist <dir>] [--viewport both|phone|tablet-landscape] [--json]
gm test [--inputs <script.json>] [--ticks <count>] [--deadline <seconds>] [--serve <dir>] [--out <dir>] [--json]
gm run [--verify-source] [--frame host|app|bare] [--viewport touch|all|<one>] [--inputs <script.json>] [--frames <seconds,...>] [--out <dir>]
gm look sheet <screen> --still <png> [--target <png>]
gm look check [--changed [<base>] | --all] [--screen <id> ...] [--phase mock|prototype|build|polish] [--json]
gm look scope add <screen> --still <png> [--still <png> ...] [--base <base>]
gm look evidence --body <file> [--json]
gm decisions check [--game <slug>]
gm decisions render
gm decisions next --ticket <n> [--body <file>]
gm decisions raise <id>
gm decisions answer <id> <option label> [--note <text>]
gm decisions sync
```

`gm check` runs TypeScript, deterministic simulation-source, test-hook, and registered asset gates. Use `static` or
`hooks` to select only that gate group. Failures name `file:line` where available and exit 1; `--json` emits the L0
gate result. `--phase` supplies the current look rung when evaluating provisional look scopes; it defaults to
`prototype` when no provisional scope is declared. A provisional scope requires the caller to pass the current rung, so
expiry cannot remain green because a command defaulted to an earlier phase.
In ticket PR mode, pass `--body <file>` and `--base <ref>` to also reject open creator decisions and
creator-visible changes without a prototype review section (or `Prototype review: none` for code-only changes), and a
Play link that starts no `scenario=`.
Pass `--lane creative` or `--lane clone` when checking a PR for those ticket lanes. A creative mock PR cannot change
game source; changed mock images need their `request-mock.py` image record with two real pack/set references, or the
game logo for title, loading, end, and thumbnail screens. Prototype and build rungs require an approved target in the
checked-in review decisions with an approval `phase` (`mock`, `prototype`, `build`, or `polish`): prototype work accepts
`mock` or later, while build work needs `prototype` or later. Clone lane PRs require a valid `recipe.json`, its generated sprite output, creator approval,
attached originals, numeric scores and passing `gate_results`.
`gm publish` requires a prototype review round for the commit when the game has a decision inventory; games without an
inventory continue with a reported gate line.

`gm check images` validates creator-visible image slots against `@ogm/contracts`; `gm check` runs the same check for
games with a manifest. It checks required viewport variants, display aspect ratios, layered safe areas, and phone text
size and contrast. Legacy `loading.portrait` and `loading.landscape` keep their existing 9:16 and 16:9 source checks;
when either is shipped, also declare a complete `images.loading` viewport set. Games without shipped thumbnail, logo,
loading art, or `images` slots pass without image checks.

`gm images compose` renders every layered image slot into its declared viewport variants. It writes 2x PNGs under
`public/media/slots/` by default, or to the paths listed in the slot's `variants` map.

`gm decisions check` validates `docs/<slug>/decisions.json` and fails when its grouped `decisions.md` render is stale;
`gm decisions render` refreshes it. `gm decisions next --ticket <n> --body <ticket-body.md>` prints the ticket's open
decisions as JSON, including IDs linked from its `## Creator decisions` section when the inventory has no ticket number.
Raise an entry with `gm decisions raise <id>` after every option has media, then record the creator's answer with
`gm decisions answer <id> <option label> [--note <text>]`. `gm decisions sync` reads answered review maps from the local
Aiur API and records likes and notes for raised decisions in `decisions.json`.

`gm check boot` serves the build and checks readiness and visible frames at phone and landscape sizes. Frames with
more than 98% of pixels near one color fail. It writes
`shots/boot/phone.png` and `shots/boot/tablet-landscape.png`; `--dist` selects a build directory and `--viewport`
selects both sizes (the default) or one size. Published games signal
that their first frame is ready by setting `runtime.hooks.ready = true` after loading assets and rendering. Rebuild older
published builds with the current SDK before using this check; they do not emit the frame-ready signal.

`gm test` first runs the boot check, then serves the built game from `dist/` on `127.0.0.1`, advances 3,600 fixed ticks by default, applies an optional
logical-input script, checks a save-state round trip, writes a HUD still, runs `promises/*.spec.ts`, and writes
`shots/test/report.json`. A failed or unavailable check exits 1. `--serve`, `--ticks`, and `--out` override the defaults;
`--json` emits the L1 gate result and report path. The deadline defaults to 120 seconds plus one second per 30 ticks,
capped at 20 minutes; `--deadline` overrides it in seconds. The command reports progress every 10 seconds and stops after
90 seconds without tick progress. On a stall, inspect `stall.json` and the available frame images in the output directory.
On Linux, `gm test` selects SwiftShader when no GPU render device is available. Set `GM_VERIFY_SOFTWARE_GL=1` to force
SwiftShader or `GM_VERIFY_SOFTWARE_GL=0` to request the GPU. A failed HUD capture reports that it captures the whole page
and writes `hud-dom.html` in the output directory when the page remains responsive.

`gm run` captures deterministic stills, timelines, clips, and browser budgets. It writes `report.json` plus
`state.json` containing the final `renderGameToText()` value when that hook is available; sameness evals use the state
keys without exposing values. Use `gm help run` for viewport, recording, rig, and asset-tier flags. `--record-native`
records the game canvas at its pixel size, scaled up only by a whole-number factor, rendering every frame through the
game's deterministic hook so a clip holds exactly duration x fps frames.
For local captures, `gm run` runs a Vite game build in test mode (including its prebuild asset staging) in a separate
temporary directory. Other builds use `dist`. A capture of an independently served `--url` uses that server as-is.
`--verify-source` also requires committed tracked changes and no untracked build inputs; git-ignored files are excluded.

By default `gm run` captures the play screen as a player sees it: the build mounted through `@gm/host` (the app's own
touch overlay, viewport tracking and bridge) with the app's menu and Pause, styled with the app's own
stylesheets, at 390x844, 844x390, 820x1180 and 1180x820 with touch on (`--viewport touch`). `--viewport all` adds the
1440x900 desktop, and one name (`phone`, `phone-landscape`, `tablet`, `tablet-landscape`, `desktop`) captures only it.
`--frame app` captures inside the real signed-in app instead: it opens `/play/<gm.manifest.json id>` on
`OGM_APP_ORIGIN` (or `--app <play url>`) with the QA account's Playwright storage state (`--storage`, `OGM_QA_STORAGE`,
default `~/.config/ogm/qa/storage.json`, minted on the host by `ops/bin/ogm-qa-signin`) and answers the app's requests
for the game build from `./dist`. `--frame bare` captures the game page alone, as before.

`gm scene pull <game> <scene> [--pack <adapter>]` copies a scene's latest revision, Kevin's edits included, to
`.gm/scenes/<game>/<scene>.json` (`doc` plus the `baseRev` it came from). The scene lives in the game at
`scenes/<scene>.scene.json` with its revision log `scenes/<scene>.revs.jsonl`; `--pack` names the pack adapter for a
scene that doesn't exist yet. A scene on an older schema version is upgraded on pull and the upgrade recorded as a
`migration` revision. `gm scene push <game> <scene> [--label <what changed>]` saves the edited `doc` as a revision by
`agent:<ticket>`. A push from an older `baseRev` is rebased onto the latest one. If it would change anything Kevin
edited, the whole push is refused with one line per conflict and nothing is saved: pull again and redo the rest.
A saved push also prints the link that opens the scene in the map maker at that revision
(`/<game>/edit?scene=<scene>&rev=<n>`, on `OGM_APP_ORIGIN` when set; the app resolves the game's slug to its editor page) for the agent's update to Kevin. The
scene's chip on the ticket's review card and ticket detail opens the same link.
`--json` prints `{ ok, rev, rebased, saved, link }`, or `{ ok: false, conflicts, hint }` on a refusal (exit 1).

`gm scene match <mock.png> <brief.json> --pack <id> --facing <direction> --out <new.json>` searches the
specified pack locally using the reviewed regions in the brief. It checks pack rights and source hashes; the
caller must establish that local vision processing of the mock is allowed. The output includes embeddings and
reports whether the search was truncated. `--encoder siglip` selects a cached SigLIP model instead of CLIP;
models must already be available locally.
Use `--python <path>` when the local tagging worker's Python environment is elsewhere.
The brief is JSON: `image` `{width,height}` (must equal the mock's size), `story`, `mood`, `light`, `focalRegion`
(a region id) and `regions` entries with `id`, `label`, `layer` (`ground`, `background`, `landmark`, `prop`,
`character`, `light` or `effect`) and `bounds` `{x,y,width,height}` in mock pixels. The `--out` file feeds
`gm scene identify`.

`gm scene identify <mock.png> <brief.json> <match.json>` ranks up to three sprite candidates per reviewed
brief region from a local scene-matcher result. It checks the mock hash and crop coordinates, and reports the
searched pack, facing and completeness. Candidate selection and kit-gap decisions still require review; the
command does not validate the provenance or usage rights of a supplied match file.

`gm scene compare-ground <reference.png> <render.png> <registration.json>` ranks ground-plane regions by
image mismatch using four supplied corresponding points. The JSON has `anchors` entries with `reference` and
`render` pixel points, and `regions` entries with an `id` and `{x,y,w,h}` bounds in reference pixels. Confirm the
points and regions by eye: a ground-plane warp does not align elevated objects, detect missing assets, verify
camera framing, or explain a mismatch. Regions without complete render coverage are rejected. Output records
the hashes of both images and the registration file.
Add `--out <new-sheet.png>` for reference, warped render and 50% overlay side by side; uncovered pixels are
magenta in the render panel. The command refuses to overwrite an existing file. The sheet is a ground-plane
diagnostic, so elevated objects may not align.

`gm look score <target.png> <candidate.png>` compares images locally and prints JSON. It writes `look-score.png` (or
`--out <path>`) with target, candidate, difference heatmap and 50% overlay, plus a provenance sidecar. The crop applied to both inputs
`--crop x,y,w,h` and repeatable `--region name=x,y,w,h` use pixel coordinates; regions refer to the cropped target. When none are named, a 3-by-3 grid supplies the worst five regions.
Use a settled capture with the same camera. Both images are flattened on black, and the candidate is resized to the target. SSIM, colour histogram distance,
and edge IoU are reported. An optional `--perceptual <executable>` invokes a local LPIPS adapter with two normalized PNG paths; the adapter prints
a numeric distance and must use local model weights without network calls. Without that flag, or if the adapter fails,
the perceptual score is skipped with a note. `gm look judge <sheet.png> --rubric
tiers` sends the sheet and its unchanged sources through the existing look broker, which applies its normal reference
restrictions. Its JSON reports the four tier scores and concrete differences. Later tiers are uncounted until preceding
tiers reach 7, and the verdict passes only when all reach 8.

`gm look check --changed` gates the PR on changed stills and targets against `origin/main` (or the supplied base), plus repeatable `--screen` IDs. Other failures are reported as inherited and do not fail the gate. Git-ignored renders cannot be attributed by a diff: the scope selects this ticket's renders, and other renders are reported as inherited. Visual path and game entry-point changes require a current `design/look-scope.json`: after committing visual changes, capturing fresh stills with `gm run --verify-source`, and committing any tracked stills, use `gm look scope add <screen> --still <png>` for each screen and its looked-at stills, then commit the manifest. CI can replay its recorded images, answers and look references. The manifest is reviewable evidence, not a cryptographically authenticated broker signature. `--all` audits everything. `gm look check` gates on the vision look requests (`gm-image-mock`, `request-mock.py --kind look`), which log
each answer or broker error to `.gm-mock/looks.jsonl` with the git blob id of every image they judged. It judges each
`tN.png` still committed at HEAD in the game folder (outside `review/`, which holds PR evidence), or, when none is committed (an instance repository ignores
`*.png`), each `tN.png` rendered there. The newest look on exactly those bytes decides: its answer's last line must be
`VERDICT: pass`. A `VERDICT: fail`, an answer that does not end in a verdict, no look on those bytes, or no stills at all
exits 1. A broker error or timeout (for example a 402) is reported as `blocked` and also exits 1; it is never a pass.
For a failed look, the check prints the answer so its reported differences can guide the next fixes. New look requests
ask for those differences worst first.

A game records the render and approval rung the creator approved for each screen in `review/decisions.json`
(`{"screens": {"select": {"target": "review/mock-matrix/select.png", "phase": "mock"}}}`). Creative prototype PRs require a
mock-or-later approval; creative build PRs require a prototype-or-later approval. `gm look sheet <screen> --still <png>` puts the
still beside that target (`--target` overrides it) at one height in `look/<screen>.sheet.png`, and `gm look check`
judges every such sheet like a still: a screen with no sheet, or whose sheet's newest look reads a mismatch, exits 1.
Every PNG in `design/flow/screens/target/` must also be named as a target in that file; unrecorded targets fail the
check and are listed by name.

During prototype work, a screen may mark its look scope provisional with an owner and expiry rung, for example
`{"screens":{"play":{"provisional":{"owner":"Kevin","until":"build"}}}}`.
Before the expiry rung, `gm look check` reports a visible warning and exits successfully for the missing approved target and
sheet. The creative ticket gate still requires a recorded mock approval before prototype work and a prototype approval before build work. At the expiry rung or later, `gm look check` fails until the provisional declaration is replaced by an approved look target.
Pass the active rung with `gm check --phase <rung>`; the phase does not auto-advance from the branch or ticket. While a
provisional scope exists, omitting `--phase` fails closed and asks for the current rung.

`gm look evidence --body <file>` reads a pull request body and exits 1 when it links a sheet, still or clip
(`.png`, `.jpg`, `.gif`, `.webp`, `.mp4`, `.webm`) that is not committed at HEAD, from the repository root or the game
folder, as a regular file (a symlink does not count). A worker's `assets-local/` and `shots/` are deleted after merge, so
evidence goes in `review/<ticket>/` in the game folder. URLs are not checked.

`gm verify scene <game> <scene>` checks that a map is structurally coherent and prints a ranked list to fix from the
top. `<scene>` is a Tiled-style isometric map file or a name under `<game>/maps/`. Pack facts (measured edges and alpha
bounds) come from the adapter of the set in `gm.lock.json`; a derived asset uses the facts of its `derived_from` source.
A fence or wall piece with no measured edge is reported as `facts/unmeasured-edge` (high): an unchecked run never passes.
Checks, each with a stable id: `connected-runs` (fence and wall runs end at a post, corner, building or tagged gate),
`coherent-buildings` (closed shell, roof over the footprint, a door), `no-overlap` (shared cells, sprites overlapping in
one depth band, characters inside solids), `facing` (shipped facings, edge pieces along their run, doors onto walkable
cells), `traversable` (the spawn reaches every character, door and gate; paths connect two places),
`natural-placement` (density, regular grids unless tagged `formal`, pieces over the void, void inside the frame) and,
with `--mock`, `framing`. Tiles may carry `role`, `tags` (`ruin`, `formal`, `gate`, `exit`) and `elevation`. A failing
high finding exits 1 unless `--allow` lists its id or check as a known limitation. `--out <base>` writes `<base>.json`
and `<base>.md`; `--overlay` writes a numbered diagnostic map.

```text
gm verify scene <game> <scene> [--under <map.json>@dx,dy] [--view WxH] [--zoom <n>] [--center x,y]
  [--mock <png> [--mock-character <px> --character-height <px>]] [--min-density <n>] [--allow <id>]
  [--out <base>] [--overlay <png>] [--json]
```

## Refresh the skill pack

```text
gm skills sync [--check] [--force]
gm skills list
gm skills search <words…>
gm skills show <name>
gm skills config
```

`sync` installs the platform's shared `gm-*` runtime skills, the one `gm-set-<set>` skill recorded in `gm.lock.json`,
and the vendored engine references under `.claude/skills/`. With no recorded set, it installs no set skill.
Workspace-only package metadata, TypeScript config, and skill tests stay in the platform repository. Relative links
in `.codex/skills/` and `.agents/skills/` make the same skills discoverable to each worker; filesystems without symlink
support receive copies and record `"linkMode": "copy"` in `skills.lock`.

The command preserves an installed file whose hash no longer matches the previous lock. Use `--check` to report any
missing, outdated, or locally edited file without writing; it exits 1 when drift exists. `--force` refreshes locally
edited pack files but still preserves files the pack did not install. `list` prints the discovery names currently
recorded in the lock.

`search` and `show` are the on-demand catalog: they read the game repo's installed `.claude/skills/` (the platform
pack when there is none). `search` lists skills whose name or description holds any of the words, most hits first (a hit in
the name counts twice), and exits 1 when none match. `show` prints a skill's `SKILL.md`, preceded by the `role:*` labels that make it mandatory.
Discovery never replaces the skills a ticket's labels inline.

`config` prints aiur's `agent.skills` block from `skills/gm-core/references/roles.md`: `preload_max_bytes`, then
`by_label` with one `game:<slug>` per `games/<slug>/gm.lock.json` under the current directory (`gm-core` plus
`gm-set-<set>`), then every role label with its mandatory skills. Run it from the instance root and paste it into the
instance's `.aiur/config`. The builder writes the role labels into each game daemon's config itself; it has no record
of a game's set, so the `game:<slug>` label is not in a daemon's config.

The optional `GM_SKILLS_DIR` path selects a platform skill-pack root. Normal installed use locates the pack beside
`gm-cli`; tests and source checkouts can use the override without network access.

## Read a mechanic pattern card

```text
gm docs pattern <topic> [--engine phaser|three] [--max 1..3]
gm docs pattern --list [--engine phaser|three]
```

The command reads the installed skills' `references/cards/` directories and prints matching cards verbatim. Topic,
alias, and substring matches are ranked in that order. `--list` shows each topic, engine, aliases, and optional set;
an unknown topic exits 2 with a list hint. Pattern retrieval is offline and never summarizes or rewrites a card.

## Build chat and Commands

```text
gm chat post --job <id> --text "<one line>" [--image <png>]
gm chat post --job <id> --text "<one line>" --clip <mp4> --poster <png>
gm command request [--job <id>] --question "<question>" --option <id>=<label> --option <id>=<label> [--media <id>=<chat-message-id>] [--playable <id>=<scenario query>] [--seconds <id>=<n>] [--lead-in <id>=<move>] [--branch <name>] [--provenance <id>=<json|@file>] [--recommend <id>] [--key <decision-key>] [--blocking]
gm command wait <command-id|decision-id> [--timeout <seconds>]
```

`gm chat post` copies media into `.gm/outbox/media/` and prints the chat message id. `gm command request` requires
image, audio, video, or playable media for each option, then prints
the Command id and the `decision.requested` `emit_event` call the agent must make. `gm command wait` prints
the selected option id, exits 3 on timeout, and exits 4 when the Command becomes moot.
`gm command request` and `gm decide` raise every creator Command with `blocking: true`, with or without
`--blocking`, so aiur never retires a creator's pick unseen; revert to non-blocking by default once aiur #7872 is
deployed.

Without a build job (no `--job`, `GM_JOB` or `.gm/context/job.json`), `gm command request` writes nothing to the outbox
and refuses `--media`; the printed call carries each `--playable` slice, so the Command shows as playable cards in the
game's review deck (see `packages/gm-cli/src/commands/command/README.md`). `gm decide` does the same.

`--key <decision-key>` (also on `gm decide`) names the Command for tickets that wait on it (`gm build park --on`), so
a ticket can be parked before the question is asked. Name a key after its game, such as `blobs/diorama`: several games
share one instance repository.

`--provenance <id>=<json|@file>` records what an option was built from — the packs and assets it used, its generator,
when it was built, and its design aspect, kind, and view. The ledger check reads it; a game that carries a ledger
refuses to request a Command with an option the ledger rejects.

## Record a creator rejection

```text
gm options reject --words "<creator words>" --rule "<derived rule>" --scope <characters|look|options> [--must <json>]
                  [--option <id>=<label>] [--provenance <id>=<json|@file>] [--command <id>] [--media <message-id>]
                  [--withdraw <option-id>] [--withdraw-command <command-id>] [--design-version <version>] [--job <id>]
gm options check --option <id>=<label> --option <id>=<label> [--provenance <id>=<json|@file>] [--command <id>]
```

`gm options reject` appends one entry to `design/feedback.json`, the game's creator rejection ledger: the creator's
words verbatim, the rule the agent derived, its scope, the rejected options and the Command and media they were shown
under, and the date and design version. Because the file lives in the game repository and is versioned with it, the
rejection outlives the session, the agent, and the chat it was spoken in. The command also withdraws every open
option whose provenance shares the rejected option's generator and packs, together with its Command, and prints what
it withdrew. `--must` adds the machine-checkable side of the rule as JSON, for example `{"packs":["kaykit"]}`,
`{"views":["player"]}`, or `{"kinds":["render","screenshot","clip"]}`; without it the rule stays words for the agent.

`gm options check` fails an option that breaks a ledger rule, matches a rejected option by id or provenance, or
predates a rule that applies to its scope. It exits 1 and names each violation, or prints `options ok`. Run it on any
option set before the options reach the creator; gm-verify runs it as a gate.

## Sweep ticket premises

```text
gm plan premises --tickets <issues.json> --decisions <decisions.json>
```

`gm plan premises` checks each open ticket in `--tickets` (from
`gh issue list --state open --limit 1000 --json number,title,body,state`) against the premises it names: `Decisions:`
ids, `Spec:` and `Owns:` paths relative to the repository root, and `context-sha:`. `--decisions` is the game's
decision history from `GET /internal/games/<id>/design-decisions`. A ticket is flagged when a cited decision was
revised or superseded by a later one, mooted by a later `gm options reject` that rejected its answer or withdrew its
Command, or is missing from the history, or when a spec or owned file changed between `context-sha` and HEAD. It
prints one JSON report (`flagged` with each ticket's reasons, `clean`, and `unchecked` for tickets that name no
premise) and exits 1 when any ticket is flagged. It needs no model; run it from the game's folder.

## Check ticket roles

```text
gm plan check --tickets <issues.json> [--game <slug>]
```

`gm plan check` reads `--tickets` (from `gh issue list --json number,title,labels`) and fails each ticket that lacks
exactly one `game:<slug>` label or one or more `role:*` labels from `skills/gm-core/references/roles.md`, or that
carries a role the table does not list. The roles come from the platform skill pack (`GM_SKILLS_DIR` overrides it),
the same table the builder uses. The new-game parent (`request:new-game`) is skipped, and with `--game` so is a ticket
carrying exactly one other game's label. It prints one line per failing ticket (or `plan ok`), `--json` prints the
report, and it exits 1 on any failure or when no ticket was left to check.

## Agree a scope session

```text
gm scope done --file .gm/scope/<session-id>.json
```

The file must match the agreed-scope schema and its name must match the session id. The command queues
`scope.agreed` in `.gm/outbox/scope.jsonl` for the build-chat relay.

## Build the game

```text
gm build [--json]
```

Runs `pnpm build` in the game repository, then checks that `dist/` holds `manifest.json` and `design/design.json` and
that both match the `@ogm/contracts` schemas the publisher and API read. It also requires `index.html` and `credits.json` and rejects origin-root asset paths in `index.html`, as publish does. The templates' Vite config writes both files
(`@gm/sdk/vite`): the manifest from `src/manifest.ts`, and the design folded from every design-doc `design/*.json`
(a key defined in two files fails the build). The creator feedback ledger `design/feedback.json` is skipped, so a game
that carries one still builds. Exits 1 naming each missing or invalid file.

## Pause, resume and inspect build tickets

```text
gm build pause <ticket> | --game <slug>
gm build resume <ticket> | --game <slug>
gm build park <ticket> [--on <decision-id|key> [--when <option>]]
gm build requeue <ticket>
gm build state <ticket> | --game <slug>
gm build hold-pr <ticket>
```

Each action is one aiur call on the instance repository's build tickets: `pause`, `resume` and `park` run
`aiur pause|resume|park <ticket>`, and `requeue` runs `aiur --todo <ticket>`. A ticket needs a `game:<slug>` label;
one without is refused before aiur is called. `--game <slug>` pauses or resumes every open ticket labelled
`game:<slug>` in a single aiur call and never uses `--all`, so other games stay as they are. aiur's refusal is printed
and exits 1.

`gm build park --on <decision-id|key>` parks a ticket until a creator decision is answered: gm labels it
`waits:<key>` and comments the wait. When the decision is answered (in the app, by voice or on the aiur dashboard), the
API's next poll writes the answer into the ticket as a `gm-decision-answer` JSON comment (the pick, its label and any
per-option thumbs and notes), reopens it if closed, resumes it if paused and queues it (`aiur --todo`), then takes the
label off. No Executor step is needed, and tickets without the label never move. Only the answering game's tickets
(`game:<slug>`) are released; a ticket parked on several decisions starts on the last answer. A key names the newest
Command that carries it, and a ticket parked on a decision already answered is released within a minute. A closed ticket, or one aiur has not
queued, is follow-up work the answer starts and is only labelled; `--when <option>` starts it only when the answer picks
that option and closes it as not planned otherwise.

`gm build state` reads the `agent:*` state labels, the open PR and its CI rollup from GitHub, and the ticket's status
and pause reason from `aiur units --json`. When aiur cannot answer, the status shows `-` and the reason goes to stderr.
Owner and injected skills show `-` until aiur serves its dispatch record. `--game` prints one line per open ticket.

`gm build hold-pr` exits 2: aiur has no interface yet to take a ticket out of ci-wait without closing its PR, and gm
never writes aiur lifecycle labels itself.

The repository is `--repo <owner/repo>`, else `OGM_INSTANCE_REPO` from the environment or
`~/.config/ogm/env/api.env`. `--json` prints one object.

## Build game assets

```text
gm build assets [--tier desktop,mobile,low] [--budget mobile] [--out public/a] [--ktx2] [--no-cache] [--strict]
```

The command validates `assets.lock.json` and writes GLB, WebP, MP3, and font files to
`public/a/<full-sha256>.<ext>`. Manifest URLs use the matching `/a/…` path so identical outputs are shared across
games and versions. It also writes `public/assets/manifest.json`, `public/assets/cache-plan.json`, and
`public/assets/budget.json`. The cache plan lists each file's size, kind, tier coverage, and ready/stream phase.
Models receive tiered geometry and texture limits; small prop collections that share an embedded texture are
combined into a single kit GLB. Sprite and pixel-art images keep their source dimensions and use lossless WebP
encoding.

Lazy groups in `assets.lock.json` are budgeted independently. Set tracked overrides in `gm.manifest.json` under
`assetBudgets.lazy.<group>` with `mobile` and/or `desktop` byte counts. Stream-only music/voice groups allow up to 32 MiB
on mobile/low and 64 MiB on desktop; groups with preloaded assets allow 1.5 MiB and 4 MiB. `budget.json` reports measured bytes
and the selected build budget fails when a group exceeds its limit.

A sprite card that lists several sheets — a SmallScaleInt character's action sheets, for instance — publishes every
sheet its `meta.sprite` names, not only the primary file. Each one appears in the manifest's `files` record and in the
cache plan under the asset's id, and the manifest's `meta.sprite` paths are rewritten from the card's own sheet paths
to those generated file names. A game therefore resolves each sheet beside the asset's `/a/…` URL in a built game
exactly as it does beside the copied files in a dev server; the lock keeps the collection's original paths. Sheets the
card names but the lock does not list keep their own spelling, and a basename two files share is left unresolved
rather than guessed.

Generated work is cached in one directory every checkout on the host shares, so a fresh workspace (og-merge, og-publish,
a worker build) reuses any asset another checkout already built and rebuilds only the ones whose source changed:
`GM_ASSET_CACHE_DIR`, else `$XDG_CACHE_HOME/ogm/assets`, else `~/.cache/ogm/assets`. Entries are keyed by the source
files' hashes, the tiers, the tool versions and the builder's own code. After each build the cache is trimmed, least
recently used first, to `GM_ASSET_CACHE_MAX_MB` (default 8192). When that directory can't be created or written the
build uses the repo's `.gm/cache/assets/` instead. Use `--no-cache` to rebuild without reading or updating the cache,
`--strict` to stop at the first invalid asset, or `--json` for manifest and budget data on stdout. The selected
`--budget` tier determines the exit status when a limit is exceeded. `--ktx2` requires `toktx`; KTX2 encoding is
reserved for a later release, so V1 builds should omit that flag. Audio builds also require `ffmpeg`; a conversion that
fails or writes an empty file is retried once, with its stderr in the build log, and an empty output is never cached.

## Find a map or a tileset

```text
gm maps index [--json]
gm maps search [<words...>] [--rooms 3-5] [--loops N] [--secret] [--levels N] [--size <class>]
               [--type <map type|set>] [--biome <env>] [--feature <name>] [--scale <class>]
               [--grid <type>] [--flow <flow>] [--tilesets|--maps]
gm maps info <map-card-id> [--json]
```

`gm maps index` writes `assets-local/index/maps.index.json`: one row per inspiration map and tileset card an agent may
build from, with the layout as columns (biome, features, scale, grid, rooms, loops, secrets, levels, size, flow). A map
needs `derive-layout` in its resolved rights and a tileset needs `in-game`; anything else is counted in a `hidden` line
and never reaches the file. `gm packs index` refreshes the same index, so one command keeps both current.

`gm maps search` reads only that file — no card index parse, no spec scan per query — and prints one line per hit:

```text
t1:<collection>/<map>@<version>  crypt  crypt  battlemap  square@32  4/1/1  small  loop  road,stairs,tomb,water
```

The columns are the id, the map type (or the tileset set), the biome, the scale, the grid and its cell size, rooms /
loops / secrets, the size class, the flow and the drawn features. A filter never matches a row whose column is unknown,
so `--rooms 3-5` excludes a map with no layout spec rather than assuming it has three rooms. The command prints a facet
line (`2 of 2 (map 1, tileset 1) — biome: crypt 1, dungeon 1`) so a caller narrows instead of paging.

**A map row never carries a path.** Maps are chosen from the columns and facts here; there is no preview or tile key in
the output and no preview command for an inspiration map, so an agent cannot end up looking at a four-thousand-file
library. Once an agent chooses a searchable map, `gm maps info` returns its validated abstract layout graph without a
file or preview path. Contact sheets stay a human tool: `gm assets sheet`.

## Tag local asset packs

```text
gm packs tag --kind <audio|map|model|sprite> [--only <collection-glob>] [--workers <n>] [--limit <n>] [--json]
```

The command runs only local analysis models and validates every reported card before it updates collection counts.
`--workers 0` selects the safe default; larger requests are capped at one third of the machine's logical cores. Model
and sprite passes create deterministic contact sheets before tagging. Audio passes measure tracks, build searchable
cards, and generate clips, a pack sheet, a medley, and compatibility suggestions. Map processing currently supports
the local `profantasy-cc3` collection.

Collections must allow `vision-input`; `processing: local-only` is honored. A run never downloads model weights, and
fails when the required CLIP or CLAP cache is absent. A collection lock prevents simultaneous tag runs and is released automatically when a run exits. `--json` streams one record per changed card followed by a summary. Use `--only` when processing a single private pack, for example:

A pack with `pack.json` but no `collection.card.json` is reported as a failure instead of being silently skipped; the
JSON summary includes it in `failures`, and the command exits non-zero so intake can repair the pack.

```text
gm packs tag --kind audio --only drive-barbarian-chiptune --workers 4 --json
```

## Search the asset library

```text
gm assets search <words...> [--family <id>] [--set <id>] [--kind <kind/subkind>] [--pov <id>] [--use <use>]
                 [--directions <count>] [--exclude-ai-generated]
```

`--set` restricts results to one exact curated compatibility set, such as `smallscaleint`. Inside a game repository,
the lockfile's family and compatible sets still apply unless the existing `--any-family --reason` escape is used.
`--directions <count>` keeps only directional sprites whose card records exactly that many facings, so "orc that can
attack in 8 directions" is `gm assets search orc attack --directions 8`. A sprite card carries the count as the length
of its `sprite.directions` list, in the order its sheet rows or per-direction files are read.
AI-generated assets are included by default. Text results carry an `AI-generated: <tool>` marker; JSON results expose
the typed `generation: { "method": "ai", "tool": "..." }` object.
Measured audio cards are searchable before model tagging and their text rows show `measured [low-confidence]`.
`--exclude-ai-generated` removes every card with that typed marker. A game whose **AI-generated assets** setting is off
applies the same filter automatically, and `gm assets use` refuses a flagged asset in that game.

## Reference and vendor game assets

```text
gm assets use <id...> [--vendor]
gm assets unused [--json]
gm assets vendor <id...>
gm assets register <path> --made-by-agent [--from <id>...] --game <id>
```

`gm assets use` normally records library references in `assets.lock.json` without copying bytes into the game repo.
It reads `license`, `license_source`, explicit `attribution`, and `source` from the pack manifest first, then fills only
absent fields from the asset or collection card. Explicit blank or invalid manifest values still fail, and the manifest
licence must agree with the card. Every accepted entry copies the combined metadata into the lock and regenerates
`CREDITS.md`; incomplete combined metadata is refused. `gm check assets` rejects older or hand-edited entries that omit
it. Each entry also names the curated set its pack belongs to (`set`), when it has one.
Pixel Art Atlas rows are the exception to reference-only use: the selected 16x16 row and nearest-neighbour 2x and 4x
PNGs are materialized into the game automatically, while the other 1.4 million rows remain in the library arrays.

`assets.lock.json` is the game's asset list: the build ships only what it lists. `gm check assets`, and so
`gm build assets` and `gm publish`, fail on an asset id that the game's `src/` or `index.html` names in a string
literal but the list lacks, naming the id and the file; `gm publish` checks this before it builds. Comments and test
files (`*.test.*`, `*.spec.*`) are not read. `gm assets unused` lists entries whose id or path nothing there names
any more; an id built at runtime in a template literal (`` `t3:${game}/voice/${line}` ``) counts as naming every entry
it can match, but it never fails a build.

Use `gm assets vendor` to materialise an already-locked asset under `assets/`; the command verifies every pinned hash
and updates the lock source to `vendored`. Only assets whose effective rights allow free redistribution can be
vendored. The command names each refused id and leaves that entry as a library or blob reference.

`gm assets register` moves an agent-made file into the instance blob store and records a tier-3 reference. Use
`--from` for every locked source the new file derives from so its effective rights cannot become broader and its
licence sources and attribution remain in the generated credits.

## Export and import asset libraries

```text
gm assets export --used [--game <id>|--all-games] [--games-dir <dir>] [--include-restricted] [--out <zip>]
gm assets export --all [--games-dir <dir>] [--include-restricted] [--out <zip>]
gm assets import <zip>
```

`--used` exports the library and blob-store files pinned by the current game's lock. Use `--game` or `--all-games`
with a directory of game repositories to choose a wider scope; `--all` exports every asset available to the instance.
The deterministic zip includes the relevant locks, credits, and a rights report. Assets whose rights forbid raw-file
redistribution are named but omitted unless `--include-restricted` is explicit.

`assets import` verifies every reported hash and adds files to `OGM_ASSETS_ROOT` and `OGM_BLOB_ROOT`. It never replaces
a different existing file, so the same export can be imported repeatedly.
