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
`gm.lock.json`, writes `AGENTS.md`, and installs the committed skill layout and `skills.lock`. It does not install
packages or add game entities. Install afterward from the instance repository with `pnpm install --offline`; that
refreshes the instance `pnpm-lock.yaml`, so commit the result because CI installs with `--frozen-lockfile`.

`--family` must name a family id from `packages/asset-cards/data/style-families.json`, the registry `gm assets search`
reads. A set id (for example `limezu-modern`) is refused with its family named; sets stay nested under their family.
`--set` must name a set in that registry and, when `--family` is present, belong to the chosen family. It records the
set in `gm.lock.json`, pins the exact `@gm/pack-<set>` version, and installs only that set's `gm-set-<set>` skill.

## Verify a game

```text
gm check [--json]
gm check static [--json]
gm check hooks [--json]
gm test [--inputs <script.json>] [--ticks <count>] [--serve <dir>] [--out <dir>] [--json]
gm run [--inputs <script.json>] [--frames <seconds,...>] [--timeline <from:to:step>] [--out <dir>]
gm look check [--json]
```

`gm check` runs TypeScript, deterministic simulation-source, test-hook, and registered asset gates. Use `static` or
`hooks` to select only that gate group. Failures name `file:line` where available and exit 1; `--json` emits the L0
gate result.

`gm test` serves the built game from `dist/` on `127.0.0.1`, advances 3,600 fixed ticks by default, applies an optional
logical-input script, checks a save-state round trip, writes a HUD still, runs `promises/*.spec.ts`, and writes
`shots/test/report.json`. A failed or unavailable check exits 1. `--serve`, `--ticks`, and `--out` override the defaults;
`--json` emits the L1 gate result and report path.

`gm run` captures deterministic stills, timelines, clips, and browser budgets. It writes `report.json` plus
`state.json` containing the final `renderGameToText()` value when that hook is available; sameness evals use the state
keys without exposing values. Use `gm help run` for viewport, recording, rig, and asset-tier flags. `--record-native`
records the game canvas at its pixel size, scaled up only by a whole-number factor, rendering every frame through the
game's deterministic hook so a clip holds exactly duration x fps frames.

`gm look check` gates the PR on the vision look requests (`gm-image-mock`, `request-mock.py --kind look`), which log
each answer or broker error to `.gm-mock/looks.jsonl` with the git blob id of every image they judged. It judges each
`tN.png` still committed at HEAD in the game folder, or, when none is committed (an instance repository ignores
`*.png`), each `tN.png` rendered there. The newest look on exactly those bytes decides: its answer's last line must be
`VERDICT: pass`. A `VERDICT: fail`, an answer that does not end in a verdict, no look on those bytes, or no stills at all
exits 1. A broker error or timeout (for example a 402) is reported as `blocked` and also exits 1; it is never a pass.

## Refresh the skill pack

```text
gm skills sync [--check] [--force]
gm skills list
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

## Build chat and checkpoints

```text
gm chat post --job <id> --text "<one line>" [--image <png>]
gm chat post --job <id> --text "<one line>" --clip <mp4> --poster <png>
gm checkpoint open --job <id> --question "<question>" --option <id>=<label> --option <id>=<label> [--media <id>=<chat-message-id>] [--provenance <id>=<json|@file>] [--recommend <id>] [--blocking]
gm checkpoint wait <checkpoint-id|decision-id> [--timeout <seconds>]
```

`gm chat post` copies media into `.gm/outbox/media/` and prints the chat message id. `gm checkpoint open` prints
the checkpoint id and the `decision.requested` `emit_event` call the agent must make. `gm checkpoint wait` prints
the selected option id, exits 3 on timeout, and exits 4 when the checkpoint becomes moot.

`--provenance <id>=<json|@file>` records what an option was built from — the packs and assets it used, its generator,
when it was built, and its design aspect, kind, and view. The ledger check reads it; a game that carries a ledger
refuses to open a checkpoint with an option the ledger rejects.

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
that both match the `@ogm/contracts` schemas the publisher and API read. The templates' Vite config writes both files
(`@gm/sdk/vite`): the manifest from `src/manifest.ts`, and the design folded from every design-doc `design/*.json`
(a key defined in two files fails the build). The creator feedback ledger `design/feedback.json` is skipped, so a game
that carries one still builds. Exits 1 naming each missing or invalid file.

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

A sprite card that lists several sheets — a SmallScaleInt character's action sheets, for instance — publishes every
sheet its `meta.sprite` names, not only the primary file. Each one appears in the manifest's `files` record and in the
cache plan under the asset's id, and the manifest's `meta.sprite` paths are rewritten from the card's own sheet paths
to those generated file names. A game therefore resolves each sheet beside the asset's `/a/…` URL in a built game
exactly as it does beside the copied files in a dev server; the lock keeps the collection's original paths. Sheets the
card names but the lock does not list keep their own spelling, and a basename two files share is left unresolved
rather than guessed.

Generated work is cached under `.gm/cache/assets/`. Use `--no-cache` to rebuild without reading or updating that
cache, `--strict` to stop at the first invalid asset, or `--json` for manifest and budget data on stdout. The selected
`--budget` tier determines the exit status when a limit is exceeded. `--ktx2` requires `toktx`; KTX2 encoding is
reserved for a later release, so V1 builds should omit that flag. Audio builds also require `ffmpeg`.

## Find a map or a tileset

```text
gm maps index [--json]
gm maps search [<words...>] [--rooms 3-5] [--loops N] [--secret] [--levels N] [--size <class>]
               [--type <map type|set>] [--biome <env>] [--feature <name>] [--scale <class>]
               [--grid <type>] [--flow <flow>] [--tilesets|--maps]
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
library. Contact sheets stay a human tool: `gm assets sheet`.

## Search the asset library

```text
gm assets search <words...> [--family <id>] [--set <id>] [--kind <kind/subkind>] [--pov <id>] [--use <use>]
                 [--directions <count>]
```

`--set` restricts results to one exact curated compatibility set, such as `smallscaleint`. Inside a game repository,
the lockfile's family and compatible sets still apply unless the existing `--any-family --reason` escape is used.
`--directions <count>` keeps only directional sprites whose card records exactly that many facings, so "orc that can
attack in 8 directions" is `gm assets search orc attack --directions 8`. A sprite card carries the count as the length
of its `sprite.directions` list, in the order its sheet rows or per-direction files are read.

## Reference and vendor game assets

```text
gm assets use <id...> [--vendor]
gm assets unused [--json]
gm assets vendor <id...>
gm assets register <path> --made-by-agent [--from <id>...] --game <id>
```

`gm assets use` normally records library references in `assets.lock.json` without copying bytes into the game repo.
It refuses a card whose pack cannot supply `license`, `license_source`, explicit `attribution`, and `source` metadata.
Every accepted entry copies that metadata into the lock and regenerates `CREDITS.md`. `gm check assets` rejects older or
hand-edited entries that omit it. Each entry also names the curated set its pack belongs to (`set`), when it has one.

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
