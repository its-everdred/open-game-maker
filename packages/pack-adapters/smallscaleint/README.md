# @gm/pack-smallscaleint

Adapter for the SmallScaleInt isometric 2D set (Phaser). It reads layout from the asset manifest's `meta.sprite`
through `@gm/sdk/assets`, never from pack files, and ships no asset bytes.

## Binds

- `createSpriteActor(scene, loader, id, { variant })`: one texture per action sheet of the variant (`shadow` or
  `shadowless`, else the action's untagged sheet), one Phaser animation per action and direction, and `sync({ x, y, facing, action, t })`, which sets
  position, frame and depth (`y`). `action` is a role from `vocabulary` or a set action name; loop roles repeat, the
  rest play once and hold their last frame. Sheets are fetched beside the asset's file: the manifest names each
  generated sheet there (`gm build assets` publishes every sheet a card lists), so the same lookup serves a built game.
- `facing8(vx, vy, hold?)`: the nearest of 8 facings for a screen velocity, with hysteresis on sector edges.
- `IsoMap(json)`: the finite Tiled isometric subset (128×64 tiles; `floor`, `wall`, `decor`, `roof`, and `spawns`).
  `render(scene, loader)` anchors 128×256 and 256×256 ground images on the 128×64 cell and draws taller pieces as
  depth-sorted facing sprites. `sync()` accepts game-owned `solid` and `visible` overrides; `collisionGrid()` and
  `roofTilesAbove()` expose simulation and cutaway inputs without implementing either policy.
- `isoToWorld` / `worldToIso`: origin-free projection helpers for the set's 2:1 diamond.
- `paletteFrom(cards)`: four-facing placeable cards grouped by measured environment category, with one-cell
  footprints and cell/edge placement metadata. `validatePlacement(prefab, pose, map)` checks floor cells and wall
  edges with the `GameInstance.validatePlacement` result shape.
- `conventions`: the pack facts, each with how it was verified (sheet row order E, SE, S, SW, W, NW, N, NE, measured
  pixel by pixel against the angle-named frame files), and `layerForCategory` for tileset pieces.
- `structuralImageBounds`: inclusive alpha bounds for six measured structural or paving assets, keyed by asset card id.
  Bounds do not establish an anchor or connection socket.
- `vocabulary`: canonical roles to this set's action names, and the loop set.

## Leaves to the game

- Which sheet is the player, and which role a button plays.
- Movement, speeds and the hysteresis width.
- Combat, hit boxes and damage; doors, chests, inventory, dialogue and HUD.
- Door, destructible and roof-cutaway policy; the adapter only consumes generic visibility/solidity state.
- Physics, movement, pathfinding and a map-painter UI.

## Verified

`pnpm --filter @gm/pack-smallscaleint test` draws numbered synthetic 128 px and 64 px sheets, checks every action,
direction and frame lands on its cell, exercises a generated 4×4 map, and checks the shared edges of a 2×2 floor
using a committed diamond and, when available, a library tile. Playwright renders the floor and an actor through
Phaser WebGL and checks Canvas rendering and the four facing textures.
