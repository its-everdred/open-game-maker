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
- Each screen node shows its **target** image, the approved render or mock from the visuals track (the buildable
  target, rendered in the engine where one exists), and, once the screen is built, its **live** still from
  `gm run` at phone portrait: `screens/<id>.target.png` and `screens/<id>.live.png`. A screen with no target yet gets a
  plain node and a visuals ticket.

The **Screens** table lists each node with its target's decision id, its live still's build and the tickets that build
it. The **Open choices** table lists every question the diagram cannot settle yet.

## Render

```sh
node .claude/skills/gm-new-game-plan/scripts/render-flow.ts games/<name>/design/flow
```

It writes `design/flow/render/<n>-<level>.png`, each screen's images embedded, so the navigation render is a
storyboard of the game. It fails on a missing screen image. Look at every render before sending it (gm-verify).

## Review

- Each open choice is a `gm decide` question with the alternatives drawn as media: render each variant of the affected
  part of the graph (mode then character beside character then mode) and attach the renders, recommended one first.
- Send the rendered levels in the review deck with the choices. The creator approves the diagram as a whole once the
  choices are answered or defaulted.
- Commit the approved `flow.md`, `screens/` and `render/` in the game repo and set Status to approved with the decision
  ids.

## Using it

- Every screen and gameplay ticket names its node or loop (`flow: round_end`, `flow: session loop`).
- Every QA journey (`gm-qa`) follows a path of edges and names the edges it takes; together the journeys cover every
  edge, back paths and multiplayer edges included.
- A later decision that changes a screen, an order or a loop updates the diagram first, re-renders it and re-asks
  only the changed part.
