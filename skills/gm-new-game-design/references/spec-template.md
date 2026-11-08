# Game design spec (new-game skill output, Executor input)

Write the spec as Markdown with these sections in this order. Keep each section concrete: things a player does or
sees, and how to tell it works. Unknowns go in "Open questions and defaults", never left implicit.

```markdown
# <Game title> — design spec v<n>

## 1. Summary
- Pitch (one sentence):
- Player fantasy (what it feels like to play):
- Creation choices: genre [...], vibe [...], style family / set, world [...], players (solo | multiplayer N),
  point of view (side | topdown | iso | follow | orbit | fps)

## 2. Goals and non-goals
- Goals (3–6):
- Non-goals (explicitly out):

## 3. Core loop
- Moment to moment (seconds):
- Session loop (minutes):
- Long loop (progression across sessions):

## 4. Platform and controls
- Devices: phone touch | keyboard and mouse | gamepad (which are required)
- Actions → inputs table (action, touch, keyboard, gamepad)
- Camera:

## 5. Rules and systems
- Player abilities and stats:
- Enemies / hazards / NPCs (behaviours):
- Items, economy, crafting (if any):
- Physics needs (2D arcade, 3D Rapier, none):

## 6. World and levels
- Structure (levels, open map, rooms, procedural):
- Level list for the prototype, then for the full game (name, goal, new element introduced):
- Map sources (asset-pack tilesets, generated, hand-placed):

## 7. Characters and story
- Main characters (role, look, asset source):
- Story spine (beginning, turn, end) and how it is told (text, voice lines, none):

## 8. Art direction and assets
- Style family and set (one family per game):
- Chosen packs and key assets (pack id → what it is used for):
- Gaps that need variants or new art (and the tier: variant of an owned asset, generated, hand-made):

## 9. UI and HUD
- Screens (title, pause, game over, level select, settings, ...):
- HUD elements:

## 10. Audio
- Music direction per area or state (library tracks or mood):
- Sound effects list (key events):
- Voice lines (if any):

## 11. Multiplayer (if players > 1)
- Mode (co-op, versus), room size, what syncs:

## 12. Progression, win and loss
- Win condition(s):
- Loss / fail state and retry:
- Saves (what persists):

## 13. Prototype ladder (built first; see gm-new-game-plan/references/prototype-ladder.md)
- Rungs P1..Pn: what each proves (one question each) and the scenarios the creator opens to try it:
- Its content (one level, one enemy type, ...):
- Acceptance per rung (observable):
- Track directions known so far (visuals, characters, audio); their stages decide the rest:

## 14. Full-game acceptance criteria
- Observable checks for the complete game (player can ..., on phone and desktop):

## 15. Open questions and defaults
- Each open or defaulted decision: id, question, current answer, origin (player | default), what changes if revised.

## 16. Decision log
- The decision records from the conversation (see question-protocol.md).

## 17. References
- Attachments, sample media, asset lineups (opaque references to private storage for anything from the player).
```

The Executor needs sections 1, 3–6, 8, 13 and 14 to be filled; anything else may say "default" with the default named.
