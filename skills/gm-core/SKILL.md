---
name: gm-core
description: Load first in every Game Maker build. Routes the work, keeps the brief in control, and defines done.
---

# Game Maker core

## The job

Build the game in `gm scope`. The scope owns the WHAT: theme, art, names, palette, and mechanics. Templates,
skills, pattern cards, and engine references are HOW. Never add a mechanic the scope does not list; suggest it in
the build chat instead.

Before coding, write a five-line plan and a short list titled "defaults I'd reach for." Drop each default or justify
it against the scope. Templates are engine scaffolds, not game designs: do not inherit a theme, entity, HUD, name,
or mechanic from them. Play spends no paid API unless `gm policy` says an admin turned it on (default off): bake LLM,
voice and media content at build time, and never put a provider key in the game; publishing refuses both.

## Keep the layers honest

Pack facts go on asset cards or in the set adapter, never in the game. Call the adapter for rendering, collision,
and maps; keep gameplay in `src/features/`. If the second game on the same set would copy a rule unchanged, note it
under `## Promote` for L2. If the second set or dimension would reuse adapter code unchanged, propose it for L1.
Until that evidence exists, write the rule once in L3 before promoting it. Pattern cards stay copyable guidance,
and an ejected adapter becomes game-owned L3 code until the package can serve the game again.

## Choose assets before making them

Use this order and say when you move down a tier:

1. Installed packs: search, inspect, and make a labelled lineup before choosing.
2. Mirrors: search tier 2 when the installed set has no fit.
3. Variants: clone a selected source and register the derived asset; never edit an original.
4. Made from scratch: only when the first three tiers cannot satisfy the scope.

Keep one style family per game. Use `gm assets sheet` for visual choices and record why the chosen items fit.

**Never re-offer a rejected option.** `design/feedback.json` is the creator's rejection ledger and each entry's rule
holds: run `gm options check` before the creator sees options; record a new rejection with `gm options reject`. Give
each option its provenance (`gm decide … --provenance <id>=@<file>.json`): the check reads its packs, assets, generator
and build time, and a ledger-carrying game refuses an option nobody can check.

**A pack you cannot reach is a blocker, not a reason to drop a tier.** If `gm assets search` fails, the asset library is
missing or unreadable, or a card's files will not load, stop asset work and tell the Executor (`Executor:` in the
workpad) the path and the error. Never present procedural stand-ins, primitives or placeholders as options for a
creator's choice; a choice shown with stand-ins is not a choice.

## Build loop

**Ask, don't assume.** At any stage (a prototype, a failed review, a spec gap), before deciding anything a player would
notice, ask with `gm decide`: a 2-5 word `--topic`, as many options as needed, each showing the thing itself (`--media`
or `--playable`), and `--recommend` with a `--reason`. Related questions share a topic; `design/decisions.json` refuses
one already asked unless the creator reopens it (`--revisit`). At most three per edit; new games follow
gm-new-game-design. Engineering and operations questions never go to the creator: decide them or tell the Executor.
Build the choice. After every `gm run`, send exactly one still or clip with `gm chat post`, unasked. Done means
`gm check`, `gm test`, and `gm run` are green and the PR's checklist is answered from the evidence sheet; look first.

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

Use one of: `asset_pipeline`, `level_and_map_building`, `gameplay_code`, `animation_and_vfx`, `audio`,
`ui_and_hud`, `playtesting_and_verification`, `deploy_and_release`, `writing`.

## `gm` cheat sheet

- `gm assets search|facets|info` finds and inspects candidate cards.
- `gm assets sheet` makes the labelled lineup; `gm assets use|vendor|register|variant|list|unused|why` records choices
  and derivatives; record an asset with `gm assets use` as soon as the code names it (the build fails on an unlisted id).
- `gm maps search` finds map sources; `gm build assets` builds the selected asset manifest.
- `gm check`, `gm test`, and `gm run` are the definition-of-done gates.
- `gm shot` captures evidence; `gm perf` checks frame and resource budgets.
- `gm docs pattern` retrieves a mechanic card without loading a whole reference game.
- `gm chat post` sends the current still or clip to the build chat.
- `gm decide` asks the creator a product question; `gm checkpoint wait` waits for the answer.
- `gm changes` summarizes the current game-repo diff.
- `gm publish` (operator, on the host) builds a registered game at its repository's remote main and publishes it.
- `gm energy` shows the instance's Energy and the creator's Save/Balanced/Best preference.

## Load when…

| Skill | Load when… |
|---|---|
| gm-core | Starting or resuming any Game Maker build. |
| gm-asset-showcase | Building or verifying a pre-rendered asset-set showcase. |
| gm-asset-variants | Recolouring a model, attaching a prop to a rig joint, or making any variant of a library asset. |
| gm-video | Rendering a short deterministic title card, trailer beat, or motion graphic locally. |
| gm-voiceover | Making a short consented local voice draft and caption timing. |
| gm-3d | Authoring or checking offline 3D assets with Blender before Three.js runtime work. |
| gm-build | Installing or building in the network-off sandbox. |
| gm-verify | Checking behavior, visuals, accessibility, performance, or evidence. |
| gm-qa | QA-ing a hosted build like a player: phone and desktop, journeys, rooms across devices, report. |
| gm-genre-platformer | Building or tuning a platformer. |
| gm-input | Adding input actions, buffering, rebinding, or accessibility. |
| gm-ui-hud | Building menus, HUD, layout, or readable game text. |
| gm-audio | Adding or tuning music and sound effects. |
| gm-multiplayer-ready | Structuring player state or building multiplayer. |
| gm-image-mock | Any visual design review: step 1 is generated mocks of the player screen in the kit, before dioramas. |
| gm-scope-options | Turning a vague brief into distinct creator-facing options. |
| gm-new-game-design | Scoping a new game from the New Game flow with the player. |
| gm-new-game-plan | Executor: turning a new-game spec into a prototype ladder of staged tickets and a Build Order. |
| gm-editor-tuning | Exposing safe creator-tunable values. |
| gm-repair | Repairing a failed build or verification gate. |
| gm-set-<set> | Using a set's adapter named by `gm.lock.json`. |
| gm-pack-adapter | Changing shared pack code or proposing a promotion. |
| vendor/phaser | Working in Phaser; load only the capability needed. |
| vendor/threejs | Working in Three.js; load only the capability needed. |
| vendor/gamedev | Needing a focused game-development reference; `.claude/skills/gm-core/references/roles.md` lists each role's picks. |
