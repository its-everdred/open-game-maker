---
name: gm-new-game-plan
description: Load as the Executor when a new-game parent issue (label request:new-game) arrives with a design spec. Architects the whole game, cuts parallel tickets with shallow dependencies, files them with features, epics and an aiur Build Order, plans the game as a five-stage prototype ladder (concepts, dioramas, rendered gameplay clips, real gameplay, iterations) with a creator review at each stage, and keeps re-planning as decisions change.
---

# New-game planning (Executor)

The parent issue is a planning record, never a worker ticket. Only the Executor takes it (it carries
`request:new-game` and no dispatch label). Edits to an existing game are single tickets and never use this skill.

## Inputs

The parent issue's public summary, its private context (the New Game form choices, spec from `gm-new-game-design`,
chat, voice transcript, attachments), the instance repo (`games/`, `packages/`), `gm-core`, the set skill for the chosen style, and
`../gm-new-game-design/references/resources.md`. Open questions still pending stay pending; plan around them.

## Plan the whole game, prototype first

The general rules for cutting tickets, typing dependencies, waves and the critical path are in the `build-order` skill;
this section adds what is specific to games.

### Start from the creator's first review queue

The scope job creates the first inventory and raises its first five to eight media-backed product decisions before it
finishes. At the start of planning, read that committed inventory and the private context; preserve its IDs, answers,
defaults, source summaries and asked status. Merge in the complete spec, settled decision log, open questions, and
planning discoveries. Do not wait until ticket cutting to give the creator a first queue. Render and validate the
merged inventory (`gm decisions render`; `gm decisions check --game <slug>`), then raise any newly media-ready open
decisions in batches of five to eight with `gm decisions raise <id>`. Never re-raise asked decisions or leave the
creator's queue empty while open decisions with real media are available. After each answer or provisional default,
read the private design-decision history, sync the chosen label into the inventory with `gm decisions answer <id> <label>`,
then render and run `gm decisions check --game <slug>`. Keep free-form creator wording private and store only a
privacy-safe answer summary. Run `gm plan premises` with the current issue list and decision history before dispatching
or revising tickets so the answer changes the plan.

1. **Architecture.** Lay out the game's skeleton before any ticket: folder layout under `games/<name>/`, the systems
   (input, player, world/map, entities, UI, audio, saves, progression), their interfaces and the seams where tickets
   meet. Prefer existing SDK modules, pack adapters and `packages/` code; note likely shared pieces, but do not promote
   anything that has not been built and proven yet.
2. **Flow diagram before any screen ticket.** File a flow diagram child ticket (`role:game-design`) in every game plan. Map the core, session and meta loops and the full navigation graph
   (every screen, transition, back path and multiplayer addition), each screen node carrying its target image, and
   get the creator's answers on its open choices: `references/flow-diagram.md`, template `references/flow-template.md`.
   Screen and gameplay tickets cite their node; use provisional decisions while the non-blocking approval Command is pending.
3. **Skeleton ticket first.** One small ticket creates the folder, the template, the system stubs with their
   interfaces, data formats and test hooks, so every later ticket edits its own files.
4. **Cut tickets by ownership.** Each ticket owns a clear set of files and one outcome a player can see or a test can
   check. Use only the lanes this game needs (gameplay, controls, characters and animation, enemies, maps and levels,
   UI and HUD, story and text, music, sound, voice, saves and progression, multiplayer, polish, verification). No fixed
   count: as many as the game needs, each completable by one agent in a few hours.
5. **Shallow dependencies.** Aim for depth 2–3: skeleton → parallel systems and content → integration and polish.
   Depend on interfaces, not on finished features. Avoid two tickets editing the same file.
6. **One ticket per feature.** Each creator-request ticket climbs `phase:mock` (`model:low`),
   `phase:prototype` (`model:medium`), `phase:build` (`model:xhigh`) and `phase:polish` (`model:high`)
   on the same issue. Approval changes the phase and effort labels in place; rejection stays on that rung.
   Never file Review, Continue or Verify follow-ups. The five activities in `references/prototype-ladder.md`
   describe evidence within these rungs, not separate tickets. Use `references/build-order-template.md`,
   `references/examples/blobs-ladder.md` and `scripts/check-ladder.ts` for the plan.
7. **Non-blocking picks.** Give every option its media and ship the recommended provisional choice while the
   creator decides. Silence is not approval. For feel, supply playable slices (`gm decide --playable
   <id>=<scenario query>`); incorporate later answers on the same ticket.
   Before queueing tickets, render and validate `docs/<slug>/decisions.json` with `gm decisions render` and
   `gm decisions check --game <slug>`. Every ticket body must list its IDs under `## Creator decisions`; verify the
   tickets with `gm plan check --tickets <issues.json> --game <slug>`.
8. **Decision inventory (required).** The scope job has already committed an initial inventory before the New Game
   Finish action. Before queueing any ticket, merge into `docs/<slug>/decisions.json` and its
   `decisions.md`: every product decision the form choices, the conversation, the spec's decision log and open
   questions, and each ticket's spec hold (enemies, town, classes, loot, upgrades, inventory and HUD, bosses,
   biomes, audio, townsfolk, run structure, look), fine-grained, each with options, a recommendation and its
   sources. Options the packs already hold are lineups of the real assets. Nothing engineering-level. What the
   creator already settled enters as `answered`. Format: `../gm-core/references/decision-inventory.md`. Update it
   in every re-plan and after each deep dive; a plan with no inventory is not a plan.

## Always audio from stage 1

Every new game's stage 1 includes audio concepts from the start (worked with `gm-audio` and `gm-voiceover`): 3–4
background-music styles, 2–3 juicy sound-effect sets, an announcer (short callouts such as "Nice one!") and character
voices (expressive, never monotone). The picks are laid on the stage 3 clips, synced to the events, and wired into the
stage 4 slices. Options come from the resource packs first (`gm assets search`); generation (voices) is samples only
until the creator picks.

## Always a thumbnail, loading image and trailer

Every game plan files three media tickets in the Build Order and records their native GitHub blocked-by edges:

- **Thumbnail** (`role:visual`): composed scene key art showing the game's own play pieces as they look in the game (for Blobs, only blobs and blocks), never generic fantasy characters or people unless they are the game's actual play pieces. Art only: never draw the logo, title or any text into it; the shell overlays the manifest `logo` centred on top. Keep the centre open (roughly the middle 50% of the width and 45% of the height: calm sky, light or ground, no faces or key props), with the play pieces and action framing it from the edges and corners. Never use a gameplay screenshot; gameplay belongs in the trailer. **Design it around the actual logo:** open the logo first and composite it over every candidate before posting (the review image is the composite at tile size, not the bare art). Continuity is with the logo, not with the in-game sprites: the thumbnail does not need to be an in-engine render. When the logo is itself a scene or carries its own viewpoint (Dusk Helm's is a first-person view of a stone doorway with a torch), make art in the logo's own style and viewpoint that the logo belongs in (there: a first-person cliff wall with floor in front, so the doorway reads as a door in that wall), with the logo attached as the reference for every generation. Never put a dark circle, vignette or blob behind the logo to make it readable; fix the art instead. Show the creator composites within the first hour of the ticket, not after dozens of private iterations. The logo ships with a transparent background. Generated art attaches the game's real kit sprites as references (gm-image-mock). Block it on the logo and graphics/look tickets.
- **Loading image** (`role:visual`): by default reuse the approved games-list thumbnail background with the game's logo layered on it (creator, 2026-11-21: "reuse the game select thumbnail + logo for loading screens always by default"); make bespoke loading art only when the creator asks. Either way supply art-only `public/media/loading-portrait.png` (at least 1440×2560, 9:16) and `public/media/loading-landscape.png` (at least 2560×1440, 16:9), declared as `loading.portrait` and `loading.landscape` in `gm.manifest.json` with paths relative to `public/`. Keep the subject within the centre 70%; leave the top 25% calm for the shell logo and bottom 20% calm for its progress bar. Block it on the graphics/look tickets.
- **Trailer** (`role:visual`, `role:audio`): one 16:9 landscape trailer of gameplay only (no menus), planned and captured using [`references/game-media.md`](references/game-media.md) and passing `gm trailer --check`. Block it on the gameplay tickets.

A ticket changing art direction, logo, board or scene look, core gameplay, or adding a variety (such as a mode or multiplayer change) files the appropriate thumbnail, loading image or trailer refresh; the Executor's merge step may file it instead. Keep all three current with the published game. Follow `references/game-media.md` for capture and delivery.

## Evidence and review states

- **Foundation before replication.** Prove the risky base first (one assembled structure at the right scale, actors,
  depth and collision, movement and combat transitions, the physical interaction, saves) before tickets that multiply
  content built on it. A known-broken base is repaired, never copied.
- Every visual or audio ticket ends with real evidence (screenshots and short captures at phone portrait, phone
  landscape and desktop; audio previews) that the agent has looked at itself.
- Review states: generated → agent-reviewed → player review requested → player-approved or provisional default.
  Silence is never approval; low-confidence work (a new or poorly preprocessed pack) asks for review in small batches.
- Fairness across aspect ratios is gameplay: test encounter visibility, threat cues, aiming and puzzles on narrow and
  wide screens, not only menus.
- Private context (references to other games, the player's words) stays in private storage for authorised agents;
  public tickets describe behaviour and acceptance only, with no commercial game comparisons.

## File it in aiur

- Child issues in the instance repo, each linking the parent, with: goal, owned files, interface contract, acceptance
  checks, skills to load, assets chosen, the decisions it relies on (by id) and its flow node or loop. No raw player text: summaries only.
  Each body has a `## Creator decisions` section listing the inventory ids the ticket builds (or `none`), and each
  listed entry's `ticket` names it; an inventory entry no ticket lists is a missing ticket or a missing line.
- `aiur-main feature create` for the game (once) and `aiur-main epic set` per lane; GitHub native blocked-by edges for
  dependencies; priority labels (prototype tickets `priority:1`).
- **Roles on every ticket.** Each child carries `game:<slug>` and one or more `role:*` labels chosen by its work type
  from `../gm-core/references/roles.md` (a HUD ticket `role:visual`, a combat ticket `role:gameplay`, a ticket that
  does both gets both). aiur inlines each label's mandatory skills when the ticket starts, so a ticket without a role
  starts without the skills its work needs. Before queueing, and again after filing more children, run
  `gm plan check --tickets <file> --game <slug>` on the children you filed (each links the parent:
  `gh issue list --state open --limit 1000 --search "#<parent> in:body" --json number,title,labels`); other games'
  tickets are skipped, and it exits 1 naming each ticket with no game, two games, no known role or an unknown role.
  Fix the labels, never the check. The instance's aiur config maps the labels to skills: paste `gm skills config`
  (run from the instance root) into its `agent.skills`.
- Build Order: the parent issue is its root; confirm with `aiur-main build-orders <root>` that every child appears with
  the right edges, then queue the unblocked children (`aiur-main --todo`).
- Post the plan summary on the parent: architecture sketch, ticket list by lane, prototype set, and the inventory's
  counts by area with its link. The first batch of `open` decisions is the creator's first review queue.

## Deep-dive every ticket before implementation (always, unasked)

Once the high-level plan and the proposed Build Order exist, do not dispatch implementation yet. Run the deep dives
from the general `research-spike` skill (steps 3–5: one research agent per ticket, brainstorm → plan, woven specs,
tickets rewritten for a weaker implementer). Game specifics on top of it:

- Research tickets carry `kind:research`, the game's feature, epic, `game:<slug>` and `role:*` labels, and block their
  implementation tickets; library and asset tickets are already research and get no extra spike.
- Research docs go to `games/<name>/docs/research/<ticket>.md` and woven specs to `games/<name>/docs/spec/<area>.md`;
  private detail stays in the game's private context and is referenced, never copied.
- Feature tickets are deep-dived when the decision they build on exists (`references/prototype-ladder.md`);
  mock work is researched up front.
- Each deep dive ends by adding the creator decisions its spec found to the inventory and to its ticket's
  `## Creator decisions`; a spec never settles one by itself.
- Give each research agent the game skills its lane needs (a biome ticket gets the set and asset skills, a combat ticket
  gets input and effects skills), and the rest by name only.

## Keep it moving

- Apply provisional defaults to open Commands after about five minutes; record them as decisions (origin: default)
  and set the inventory entry `defaulted`. A defaulted decision stays on the creator's queue: a later answer wins.
- When a decision changes (a late answer), find the affected tickets and merged code, then re-plan: edit open tickets,
  rework the affected feature tickets in place, revert only what the change requires, and message running agents with `aiur-main message`.
  Answers that reach beyond the asking ticket, the pair-confirm pattern and the premise sweep:
  `references/answer-routing.md`.
- Schedule with the instance's normal limits and queue; small edits to other games may jump ahead of a large build.
- Every playable build that changes what the creator can do or see reaches them as a prototype review (play link,
  clip, works now, known limitations, 3–6 decisions to weigh in on; same reference), never as a bare "it's ready"
  (and never open the game for them). A published build with no review raised is the Executor's to raise that hour.

## Done

All children merged, the flow diagram in `design/flow/` matches the game, the game passes `gm check`, `gm test`, `gm run` and the spec's acceptance criteria, the parent
issue has the final summary, no inventory entry is still `open`, and reuse candidates are noted under `## Promote` for later.
