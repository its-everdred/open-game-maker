---
name: gm-core
description: Load first in every Game Maker build. Routes the work, keeps the brief in control, and defines done.
---

# Game Maker core

## The job
Build the game in `gm scope`. The scope owns the WHAT: theme, art, names, palette, and mechanics. Templates, skills, pattern cards, and engine references are HOW. Never add a mechanic the scope does not list; suggest it in the build chat instead. Loading artwork: declare `loading.portrait` and `loading.landscape` PNG paths under `media/` in `gm.manifest.json`, with 9:16 (at least 1440×2560) and 16:9 (at least 2560×1440) art in `public/media/`. Also declare `images.loading` with `per-ratio` variants for phone-portrait, phone-landscape, tablet-portrait, tablet-landscape, and desktop, each matching its display ratio.
Keep the subject in the centre 70%, the top 25% calm for the shell logo, and the bottom 20% calm for progress. Run `gm check`. For asynchronous startup, set `runtime.hooks.ready = false` before starting work and `true` only after the first frame renders.

Before coding, write a five-line plan and a short list titled "defaults I'd reach for." Drop each default or justify it against the scope. Templates are scaffolds, not game designs: do not inherit a theme, entity, HUD, name, or mechanic.
Play spends no paid API unless `gm policy` says an admin turned it on (default off): bake LLM, voice and media at build time; never put a provider key in the game. Publishing refuses both.

## Keep the layers honest

Pack facts go on asset cards or in the set adapter, never in the game. Call adapters for rendering, collision, and maps; keep gameplay in `src/features/`. If the second game on the same set would copy a rule unchanged, note it under `## Promote` for L2. If the second set or dimension reuses adapter code unchanged, propose L1. Until that evidence exists, write the rule once in L3 before promoting it. Pattern cards stay copyable guidance; an ejected adapter becomes game-owned L3 until its package can serve the game again.

## Choose assets before making them

Start from approved work: `gm context` lists what this game's earlier tickets got approved (kits, biomes, ground maps, generators); it is inlined below as **Build on this approved work** when it found any. Reuse or extend it, never rebuild it, and say in the workpad what you reused or why none applied. Then use this order and say when you move down a tier:

1. Installed packs: search, inspect, and make a labelled lineup before choosing.
2. Mirrors: search tier 2 when the installed set has no fit.
3. Variants: clone a selected source and register the derived asset; never edit an original.
4. Made from scratch: only when the first three tiers cannot satisfy the scope.

Keep one style family per game. Use `gm assets sheet` for visual choices and record why the chosen items fit.

**Never re-offer a rejected option.** `design/feedback.json` is the creator's rejection ledger and each entry's rule holds: run `gm options check` before the creator sees options; record a new rejection with `gm options reject`. Give
each option its provenance (`gm decide … --provenance <id>=@<file>.json`): the check reads its packs, assets, generator
and build time, and a ledger-carrying game refuses an option nobody can check.

**A pack you cannot reach is a blocker, not a reason to drop a tier.** If `gm assets search` fails, the asset library is
missing or unreadable, or a card's files will not load, stop asset work and tell the Executor (`Executor:` in the
workpad) the path and the error. Never present procedural stand-ins, primitives or placeholders as options for a
creator's choice; a choice shown with stand-ins is not a choice.

Set `IMPECCABLE_BIN="$HOME/.impeccable/bin/0.1.25/impeccable"` and `DO_NOT_TRACK=1` in the worker environment; if unavailable, the skill continues in degraded mode. For DOM/CSS UI (shell, menus, HUD overlays, review pages), load [impeccable](../vendor/impeccable/impeccable/SKILL.md) and use critique, audit, polish, layout, typeset or adapt; GM rules win: keep the prototype palette, avoid needless text, never stretch images or cover the board, and target Kevin’s concept. Approved OGM UI: `prototypes/ogm-glass/` (open `index.html`); match it exactly. In-canvas art keeps its own skills; Catalog rolls and card images are allowed with tracking off; workers must not use live, generate, login or health, or re-enable tracking or update checks.

## Build loop

**Ask, don't assume.** At any stage (prototype, failed review, spec gap), before deciding anything a player would notice, ask with `gm decide`: a 2-5 word `--topic`, options showing the thing itself (`--media` or `--playable`), and `--recommend` with a `--reason`. Related questions share a topic; `design/decisions.json` refuses repeats unless reopened with `--revisit`. At most three per edit beyond ticket inventory; new games follow gm-new-game-design. Engineering or operations questions never go to the creator: decide or tell the Executor. **You think of the decisions; the creator makes them.** `docs/<slug>/decisions.json` lists every product decision, and tickets name ids under `## Creator decisions`: at the start, raise each `open` one non-blocking, with media on every option and pack assets as a real lineup; build your recommendation and record the answer. Add discovered decisions to inventory first; never settle one silently.
Deliver a playable build that changes what the creator can do or see only after prototype review is raised (play link, clip, works now, known limitations, what to weigh in on). Format and rules: `references/decision-inventory.md`.
Build the choice. After every `gm run`, send exactly one still or clip with `gm chat post`, unasked. Done means
`gm check`, `gm test`, and `gm run` are green and the PR's checklist is answered from the evidence sheet; look first.

For planned creator decisions, save the ticket body; run `gm decisions next --ticket <n> --body <ticket-body.md>` and
raise each open entry with `gm decisions raise <id>` (validates option media and records the Command). After a
`gm-decision-answer`, use its exact `option_label`, pass any creator note via `--note` (JSON-stringify structured text),
and run `gm decisions answer <id> <label> [--note <text>]` before changing the build.

## Energy
Run `gm energy` at the start. `save` means a cheaper model, lower effort, and optional work deferred. `best` means the
strongest model and effort. `balanced` is in between. When Energy is `limited` or `critical`, propose any scope cut as a
`gm decide` question; never cut scope silently. The preference never lowers a quality gate. When Energy is `unknown` or
`gm energy` fails, work as `balanced`.

## Activity markers
Wrap long work in the Agent Workpad with these exact markers:

```text
<!-- gm-activity: <activity> start -->
<!-- gm-activity: <activity> end -->
```

Use one of: `asset_pipeline`, `level_and_map_building`, `gameplay_code`, `animation_and_vfx`, `audio`, `ui_and_hud`, `playtesting_and_verification`, `deploy_and_release`, `writing`.

## `gm` cheat sheet

- `gm assets search|facets|info` finds and inspects candidate cards.
- `gm assets sheet` makes the labelled lineup; `gm assets use|vendor|register|variant|list|unused|why` records choices and derivatives; record an asset with `gm assets use` as soon as the code names it (the build fails on an unlisted id).
- `gm-map-inspiration` owns agent-only map choice; `gm maps search|info` supplies layout facts and graphs. Edit a shared scene with `gm scene pull <game> <scene>`, change `doc` in the copy it writes under `.gm/scenes/`, then `gm scene push`; a refused push lists what the creator owns: pull again and build around it.
- `gm check`, `gm test`, and `gm run` are the definition-of-done gates.
- `gm shot` captures evidence; `gm perf` checks frame and resource budgets.
- `gm docs pattern` retrieves a mechanic card without loading a whole reference game.
- `gm chat post` sends the current still or clip to the build chat.
- `gm decide` asks; `gm command wait` waits, or park on it; a `gm-decision-answer` comment answers. `gm ask` queues words.
- `gm changes` summarizes the current game-repo diff; `gm context [ticket]` lists the game's approved work to build on.
- `gm preview [--ticket <number>] [--branch <id>]` builds this workspace for creator review without changing the live release; the verdict returns to the ticket. The game branch defaults to `main`. `gm publish` (operator, on the host) builds a registered game at its repository's remote main and publishes it.
- `gm energy` shows the instance's Energy and the creator's Save/Balanced/Best preference.
## Load when…
| Skill | Load when… |
|---|---|
| gm-core | Starting or resuming any Game Maker build. Your `role:*` labels inlined the rest (`references/roles.md`); find others with `gm skills search <words>`, `gm skills show <name>`. |
| gm-asset-showcase | Building or verifying a pre-rendered asset-set showcase. |
| gm-map-inspiration | Building the first map, a level, dungeon, world layout, or terrain. |
| gm-asset-variants | Recolouring a model, attaching a prop to a rig joint, or making any variant of a library asset. |
| gm-sprite-forge | Measuring or making sprites to match the SmallScaleInt style. |
| gm-trailer | Making or refreshing a game's gameplay trailer: inventory, shot list on the music, capture, self-check. |
| gm-video | Rendering a short deterministic title card, trailer beat, or motion graphic locally. |
| gm-voiceover | Making a short consented local voice draft and caption timing. |
| gm-hd2d | Turning on HD-2D lighting, focus or particles, or editing an HD-2D scene document. |
| gm-vfx | Adding or authoring an effect: fire, torch, cast, hit, aura; or tuning the effects budget. |
| gm-3d | Authoring or checking offline 3D assets with Blender before Three.js runtime work. |
| gm-dream-loop | Matching a game render to approved concept art. |
| gm-reference-qa | Reviewing a 3D asset against its reference. |
| gm-build | Installing or building in the network-off sandbox. |
| gm-verify | Checking behavior, visuals, accessibility, performance, or evidence. |
| gm-qa | QA-ing a hosted build like a player: phone and desktop, journeys, rooms across devices, report. |
| gm-genre-platformer | Building or tuning a platformer. |
| gm-input | Adding input actions, buffering, rebinding, or accessibility. |
| gm-ui-hud | Building menus, HUD, layout, or readable game text; includes the no-stretch image rule. |
| gm-audio | Adding or tuning music and sound effects. |
| gm-multiplayer-ready | Structuring player state or building multiplayer. |
| gm-image-mock | Any visual design review: step 1 is generated mocks of the player screen in the kit, before dioramas. |
| gm-scope-options | Turning a vague brief into distinct creator-facing options. |
| gm-new-game-design | Scoping a new game from the New Game flow with the player. |
| gm-prototype | Follow the current rung of a creator request carrying a `phase:*` label; see [gm-prototype](../gm-prototype/SKILL.md). |
| gm-scene-clone | Rebuilding an approved scene mock in the real game and comparing the capture with it. |
| gm-new-game-plan | Executor: turning a new-game spec into a prototype ladder of staged tickets and a Build Order. |
| gm-editor-tuning | Exposing safe creator-tunable values. |
| gm-repair | Repairing a failed build or verification gate. |
| gm-set-<set> | Using a set's adapter named by `gm.lock.json`. |
| gm-pack-adapter | Changing shared pack code or proposing a promotion. |
| vendor/phaser | Working in Phaser; load only the capability needed. |
| vendor/threejs | Working in Three.js; load only the capability needed. |
| vendor/gamedev | Needing a focused game-development reference; `.claude/skills/gm-core/references/roles.md` lists each role's picks. |

Creator preferences are recorded in `preferences/`; use `gm prefs list` for applicable active entries and `gm prefs check` to find conflicts. When Kevin states a new preference, record his exact words and date in the registry with an automated check or a reason it requires review. Resolve a clear replacement with reciprocal supersession links; raise a creator decision for ambiguous conflicts with both quotes and dates, recommending the newest.

<!-- preferences:start -->
## Creator preferences

Apply all-game entries and entries matching the ticket game, role or lane. Run `gm prefs check` when the registry changes.
- [approved-design-parity](https://github.com/its-everdred/open-game-maker/issues/1395#issuecomment-7210724570) (2026-11-26, all; owner #1449; review only: Applies to OGM app UI built from an approved Claude Design canvas; the gm design parity check is owned by ticket 1449 and is not yet registered here.): “i care about replicating even the smallest details”
- [controller-icons](https://github.com/its-everdred/open-game-maker/issues/1320) (2026-11-24, all; owner #1394; review only: Visual review must distinguish action icons from letters in rendered controls.): “controller buttons on screen should always use icons. not letters”
- [controller-layer](https://github.com/its-everdred/open-game-maker/issues/1394) (2026-11-26, all; owner #1394; review only: The controller conformance rule is owned by ticket 1394 and is not yet registered here.): “games should never draw their own [controls], OGM should be the controller layer with a flexible way for games to dictate the controller buttons and layouts needed for that game.”
- [image-distortion](https://github.com/its-everdred/open-game-maker/issues/837) (2026-11-17, all; owner #837; gm check: image-distortion): “i've seen agents stretch images a lot, how might we ensure and enforce that agents never stretch images and instead re-generate new ones as needed”
- [pixel-finish](https://github.com/its-everdred/open-game-maker/issues/1338) (2026-11-24, role:visual; owner #1338; review only: The visual match to the original sprites requires comparing rendered art.): “the outfit screenshots do look fuzzy from our pixel art mask. the original sprites have sharper edges and sharper shade/color transitions. clear lines separating clothing from skin etc”
- [preference-conflicts](https://github.com/its-everdred/open-game-maker/issues/1395#issuecomment-7189008304) (2026-11-26, all; owner #1395; review only: Whether an ambiguous conflict was presented to the creator requires reviewing the resulting decision.): “make sure if preferences ever conflict agent either takes the newest or surfaces conflict to me”
<!-- preferences:end -->
