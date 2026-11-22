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
  Numbered sprite layers such as `wall#1` retain multiple pieces on one cell; floor remains a single layer.
  An optional tile property `elevation` moves a sprite upward in 64-pixel grid units.
  `render(scene, loader)` anchors 128×256 and 256×256 ground images on the 128×64 cell and draws taller pieces as
  depth-sorted facing sprites. `sync()` accepts game-owned `solid` and `visible` overrides; `collisionGrid()` and
  `roofTilesAbove()` expose simulation and cutaway inputs without implementing either policy.
- `isoToWorld` / `worldToIso`: origin-free projection helpers for the set's 2:1 diamond.
- `paletteFrom(cards)`: four-facing placeable cards grouped by measured environment category, with one-cell
  footprints and cell/edge placement metadata. `validatePlacement(prefab, pose, map)` checks floor cells and wall
  edges with the `GameInstance.validatePlacement` result shape.
- `conventions`: the pack facts, each with how it was verified (sheet row order E, SE, S, SW, W, NW, N, NE, measured
  pixel by pixel against the angle-named frame files), and `layerForCategory` for tileset pieces.
- Assemblers (cells are `{ x, y }` grid cells; an opening or door is `{ cell, edge: 'xMin' | 'xMax' | 'yMin' | 'yMax' }`):
  - `edgeRun(cells | { vertices, interior: 'left' | 'right' }, 'fence' | 'stone' | 'timber', openings)` returns
    `{ placements, postVertices }`: measured facings on every boundary edge, a walkable gap at each opening, and the
    grid vertices where gate posts belong.
  - `building(footprint, 'stone', door, walkable)` returns `{ placements, entry }`: a closed shell, a gable over a
    two-row footprint, and a door on a `yMax` edge opening onto the walkable `entry` cell. Provisional until checked
    in a game render.
  - `path(from, to, { walkable, palette: [{ asset, facing }], seed })` returns stepping stones on the `decor` layer
    over the scene's own ground.
  - `scatter(region, [{ asset, facing, solid, footprint }], density, { seed, avoid, boundaries, boundaryDensity })`
    returns clustered dressing, denser near `boundaries`; pass the path, door entry and building cells in `avoid`.
    Solid items go on the `wall` layer so they block movement at their origin cell.
  - Concatenate the placements with the scene's floor and pass them to `assemblyMap(width, height, placements)`, the
    Tiled subset `IsoMap` reads. The structural asset ids are pinned card ids; record them in the game's asset list.
  - Not bound yet: gate posts, steps and non-stone buildings.
- `scripts/stage-structural-cards.mjs <library> <empty-dir>` (after `pnpm build`) writes validated card copies carrying
  the structural facts and a source-hash plan, for a host operator to apply to the shared library.
- `structuralImageBounds`: inclusive alpha bounds for twenty-one measured structural or paving assets, keyed by asset card id.
  Bounds do not establish an anchor or connection socket. `fenceB1Edges`, `wallF1Edges`, and `wallC1Edges` record measured fence, stone and timber wall facings.
  `structuralCardFacts(id)` returns the known card fields without fabricating unmeasured facts.
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
