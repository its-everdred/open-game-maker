# Game flow diagram

Every new game maps its loops and screens before any screen or gameplay ticket is cut. Without it, the order of the
menus, the game modes, whether mode or character comes first, what a round end offers and what multiplayer adds are
each guessed by a different ticket, and nobody can say which screens the game has.

## What it holds

Copy `flow-template.md` (beside this file) to `games/<name>/design/flow/flow.md`. One mermaid block per level, in this
order:

1. **Core loop**: the seconds-long cycle of play (drop, match, clear; or move, fight, loot).
2. **Session loop**: rounds, scoring, progression and rewards inside one sitting (a round, a match of rounds won per
   player, a dungeon run).
3. **Meta loop**: what carries between sessions (unlocks, power-ups bought in town). Delete the block when the game has
   none.
4. **Navigation**: every screen, every transition, every back path, and what multiplayer adds (dashed edges `-.->`).

Navigation rules:

- A node is a screen; its id (`round_end`) is the screen's name everywhere: in tickets, QA journeys and image files.
- Each edge is labelled with what the player does to take it (the button text, or the event: `Round over`).
- Every screen has a way back (or says why not: play leaves only through pause or round end).
- Each screen node shows its **target** image, the approved stage 2 diorama of the prototype ladder, or the stage 1
  concept until one exists (the buildable target, rendered in the engine where one exists), and, once the screen is
  built, its **live** still from `gm run --viewport phone` (a scenario that opens that screen):
  `screens/<id>.target.png` and `screens/<id>.live.png`. Drop the `<img>` of an image that does not exist yet; a screen
  with no target is a plain node and gets a stage 1 concept ticket.

The **Screens** table lists each node with its target's decision id, its live still's build and the tickets that build
it. The **Open choices** table lists every question the diagram cannot settle yet.

## Render

```sh
node .claude/skills/gm-new-game-plan/scripts/render-flow.ts games/<name>/design/flow
```

It writes `design/flow/render/<n>-<level>.png`, each screen's images embedded, so the navigation render is a
storyboard of the game, and replaces the old renders. It fails on a missing screen image. Run it from a host checkout:
it fetches the pinned Mermaid CLI, which the network-off build sandbox cannot do, so a builder that changes a screen
updates `screens/` and the Executor re-renders. Look at every render before sending it (gm-verify).

## Review

- The Executor owns the diagram. Draw it from the spec right after the architecture, with the targets that exist
  (plain nodes for the rest), so stage 1 concepts never wait on it.
- Each open choice is one `decision.requested` Command with `blocking: true` (as in gm-image-mock): render each variant
  of the affected part of the graph (mode then character beside character then mode) into a scratch flow directory and
  put the renders in `media[]` as options A, B, C, recommended first.
- One more Command sends the rendered levels in the review deck for approval of the diagram as a whole. Like every
  Command it gets a provisional default when the creator is silent, recorded as a default, never as their approval.
- Commit the approved `flow.md`, `screens/` and `render/` in `games/<name>/design/flow/` and set Status to approved
  with the decision ids. New targets and live stills later update the nodes without a new approval; a change of order,
  screens or loops does not.

## Using it

- Every screen and gameplay ticket names its node or loop (`flow: round_end`, `flow: session loop`).
- Every QA journey (`gm-qa`) follows a path of edges and names the edges it takes; together the journeys cover every
  edge, back paths and multiplayer edges included.
- A later decision that changes a screen, an order or a loop updates the diagram first, re-renders it and re-asks
  only the changed part.
