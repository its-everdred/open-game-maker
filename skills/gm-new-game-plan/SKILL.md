---
name: gm-new-game-plan
description: Load as the Executor when a new-game parent issue (label request:new-game) arrives with a design spec. Architects the whole game, cuts parallel tickets with shallow dependencies, files them with features, epics and an aiur Build Order, plans the game as a ladder of playable prototypes and staged domain decisions, and keeps re-planning as decisions change.
---

# New-game planning (Executor)

The parent issue is a planning record, never a worker ticket. Only the Executor takes it (it carries
`request:new-game` and no dispatch label). Edits to an existing game are single tickets and never use this skill.

## Inputs

The parent issue's public summary, its private context (spec from `gm-new-game-design`, chat, voice transcript,
attachments), the instance repo (`games/`, `packages/`), `gm-core`, the set skill for the chosen style, and
`../gm-new-game-design/references/resources.md`. Open questions still pending stay pending; plan around them.

## Plan the whole game, prototype first

The general rules for cutting tickets, typing dependencies, waves and the critical path are in the `build-order` skill;
this section adds what is specific to games.

1. **Architecture.** Lay out the game's skeleton before any ticket: folder layout under `games/<name>/`, the systems
   (input, player, world/map, entities, UI, audio, saves, progression), their interfaces and the seams where tickets
   meet. Prefer existing SDK modules, pack adapters and `packages/` code; note likely shared pieces, but do not promote
   anything that has not been built and proven yet.
2. **Skeleton ticket first.** One small ticket creates the folder, the template, the system stubs with their
   interfaces, data formats and test hooks, so every later ticket edits its own files.
3. **Cut tickets by ownership.** Each ticket owns a clear set of files and one outcome a player can see or a test can
   check. Use only the lanes this game needs (gameplay, controls, characters and animation, enemies, maps and levels,
   UI and HUD, story and text, music, sound, voice, saves and progression, multiplayer, polish, verification). No fixed
   count: as many as the game needs, each completable by one agent in a few hours.
4. **Shallow dependencies.** Aim for depth 2–3: skeleton → parallel systems and content → integration and polish.
   Depend on interfaces, not on finished features. Avoid two tickets editing the same file.
5. **A prototype ladder, not a one-shot build.** Plan the game as gameplay rungs (P1..Pn, each a playable link with
   scenarios that proves one thing) and domain tracks (visuals, characters, audio) that climb stages, each stage ending
   in a creator Command with media: read `references/prototype-ladder.md`. One ticket per stage per track, one or two
   per rung; stage n+1 is gated on stage n's decision. P1 and the first stage of each track are priority 1. A rung is a
   feedback chance, never a gate: keep building whether or not the player plays it.
6. **Questions as tickets' blockers.** A ticket that needs an open decision depends on that Command; everything else
   starts now. Content tickets that need a creative choice (music direction, character look) open their own option
   Commands with samples (see the design skill's question protocol). A gameplay-feel question (speed, chain pause,
   controls) gives each option a playable slice (`gm checkpoint open --playable <id>=<scenario query>`, `gm decide
   --playable` once #595 lands), never a link, and the question is one short line.

## Always an audio track

Every new game gets the ladder's audio track from the start (stage tickets worked with `gm-audio`, `gm-voiceover` and
`gm-image-mock`): soundtrack (3–4 background-music styles) can go out on day one; sound effects (2–3 juicy sets) and
an announcer (short callouts such as "Nice one!") wait for a rung with the core actions and are shown synced on a
gameplay capture; character voices belong to the characters track (expressive, never monotone). Options come from
the resource packs first (`gm assets search`); generation (voices) is samples only until the creator picks.

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
  checks, skills to load, assets chosen, and the decisions it relies on (by id). No raw player text: summaries only.
- `aiur-main feature create` for the game (once) and `aiur-main epic set` per lane; GitHub native blocked-by edges for
  dependencies; priority labels (prototype tickets `priority:1`).
- Build Order: the parent issue is its root; confirm with `aiur-main build-orders <root>` that every child appears with
  the right edges, then queue the unblocked children (`aiur-main --todo`).
- Post the plan summary on the parent: architecture sketch, ticket list by lane, prototype set, open decisions.

## Deep-dive every ticket before implementation (always, unasked)

Once the high-level plan and the proposed Build Order exist, do not dispatch implementation yet. Run the deep dives
from the general `research-spike` skill (steps 3–5: one research agent per ticket, brainstorm → plan, woven specs,
tickets rewritten for a weaker implementer). Game specifics on top of it:

- Research tickets carry `kind:research`, the game's feature, epic and `game:<slug>` labels, and block their
  implementation tickets; library and asset tickets are already research and get no extra spike.
- Research docs go to `games/<name>/docs/research/<ticket>.md` and woven specs to `games/<name>/docs/spec/<area>.md`;
  private detail stays in the game's private context and is referenced, never copied.
- Ladder stage tickets are deep-dived when the decision they build on exists, not before (`references/prototype-ladder.md`,
  Tickets); rungs and first stages are researched up front.
- Give each research agent the game skills its lane needs (a biome ticket gets the set and asset skills, a combat ticket
  gets input and effects skills), and the rest by name only.

## Keep it moving

- Apply provisional defaults to open Commands after about five minutes; record them as decisions (origin: default).
- When a decision changes (a late answer), find the affected tickets and merged code, then re-plan: edit open tickets,
  add rework tickets, revert only what the change requires, and message running agents with `aiur-main message`.
  Answers that reach beyond the asking ticket, the pair-confirm pattern and the premise sweep:
  `references/answer-routing.md`.
- Schedule with the instance's normal limits and queue; small edits to other games may jump ahead of a large build.
- When a rung merges, tell the player its play link and scenarios are ready (never open the game for them).

## Done

All children merged, the game passes `gm check`, `gm test`, `gm run` and the spec's acceptance criteria, the parent
issue has the final summary, and reuse candidates are noted under `## Promote` for later.
