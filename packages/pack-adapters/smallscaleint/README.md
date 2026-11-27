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
  An optional positive `scale` scales a non-floor sprite about its ground anchor. Floor scale 1 is a no-op;
  unsupported legacy scales are ignored by the renderer, reported by scene checks and refused by scene import.
  `render(scene, loader)` anchors 128×256 and 256×256 ground images on the 128×64 cell and draws taller pieces as
  depth-sorted facing sprites. `sync()` accepts game-owned `solid` and `visible` overrides; `collisionGrid()` and
  `roofTilesAbove()` expose simulation and cutaway inputs without implementing either policy.
- `TerrainMap({ width, height, terrains, cells, seed })`: dual-grid 16 terrain transitions, layered by priority
  (#1200 layout A). Cells hold one terrain index; each cell vertex picks one of 16 corner cases per terrain layer
  (that terrain or higher), so any number of terrains meet at a corner. Each cell draws as four 64x32 quarter pieces
  from the corner tiles around it (`terrainSheet` layout: 16 columns of cases, rows `variant * 4 + quarter`), which
  keeps the map edge on cell borders. Edge variants come from the seed and never repeat more than twice along a grid
  line; seeded decals land only on cells whose eight neighbours share their terrain. `paint(cells, terrain)`,
  `undo()` and `redo()` are the brush core: each returns the cell rectangle to redraw. `collisionGrid()` stays per
  cell. `renderTerrain(scene, loader, map)` draws it just above the `IsoMap` floor and `refresh(rect)` redraws a
  stroke live. Sheets are made locally by `scripts/assets/terrain_dualgrid.py`. A one-cell path that only touches
  diagonally reads as separate blobs; paint paths 4-connected.
- `isoToWorld` / `worldToIso`: origin-free projection helpers for the set's 2:1 diamond.
- `paletteFrom(cards)`: four-facing placeable cards grouped by measured environment category, with one-cell
  footprints and cell/edge placement metadata. `validatePlacement(prefab, pose, map)` checks floor cells and wall
  edges with the `GameInstance.validatePlacement` result shape.
- `smallScaleIntSceneAdapter(cards)`: the `ScenePackAdapter` for scene documents (`@ogm/contracts` scene.v1).
  Points are grid cells. `facings(asset)` lists the facings its card was drawn in (E, N, W, S without a card),
  `placement` is `edge` for walls and doors, `cell` for other pieces and `free` for spawns, and `snap` moves a point to a
  cell or the nearest edge midpoint. `layerFor(asset)`, `brushes()` (one per measured category, ground and roof
  included) and `emptyScene(game, scene, bounds)` give the layer defaults. `autotile` rewrites nothing yet: pieces keep
  the facings they were placed with until the autotile join rules land.
- `isoMapToScene(json, { game, scene })` / `sceneToIsoMap(doc)`: the Tiled subset ⇄ a scene document. Pieces become
  cell-keyed tiles with an explicit facing, `props.solid` only where it differs from the layer default (`wall` blocks),
  and the Tiled `tags` string in `props.tags` when present; true `gate`, `exit`, `ruin` and `formal` properties are
  included in that string;
  `wall#1` layers become `wall-1`; spawns become `spawn-<id>` objects on the `spawns` layer posed in 64 px units. Both
  directions are lossless for map data: the map loads the same pieces and spawns after a round trip (gids are
  renumbered), and a converted document comes back unchanged. `sceneToIsoMap` refuses what a map can't draw (flips,
  hidden layers, other object layers, unknown tile props, more than 512×512 cells) instead of dropping it. HD-2D
  settings and creator locks are not map data: they stay in the document, so `isoMapToScene` is only for moving a TS
  map into a new scene, never for rewriting an existing one.
- `conventions`: the pack facts, each with how it was verified (sheet row order E, SE, S, SW, W, NW, N, NE, measured
  pixel by pixel against the angle-named frame files), and `layerForCategory` for tileset pieces.
- Assemblers (cells are `{ x, y }` grid cells; an opening or door is `{ cell, edge: 'xMin' | 'xMax' | 'yMin' | 'yMax' }`):
  - `edgeRun(cells | { vertices, interior: 'left' | 'right' }, 'fence' | 'stone' | 'timber', openings)` returns
    `{ placements, postVertices }`: measured facings on every boundary edge, a walkable gap at each opening, and the
    grid vertices where gate posts belong.
    Supply a fourth argument `{ asset, facing, scale }` to place gate posts; this is currently inspected only for
    `yMax` fence openings and requires a one-cell map margin. The only supported style is Stone A14 facing E at scale
    0.4 with elevation 0.5. The source masks establish contact with ground-level Fence B1 E at the vertices;
    in-game depth and actor traversal still need verification. Post sprites do not block the gate cell.
  - `building(footprint, 'stone' | 'timber', door, walkable)` returns `{ placements, entry }`: a closed shell, a gable over a
    two-row footprint, and a door on a `yMax` edge opening onto the walkable `entry` cell. Provisional until checked
    in a game render. The timber style uses a thatched roof and per-piece depth offsets inspected in a standalone render;
    actor occlusion and traversal remain unverified.
  - `path(from, to, { walkable, palette: [{ asset, facing }], seed })` returns stepping stones on the `decor` layer
    over the scene's own ground.
  - `scatter(region, [{ asset, facing, solid, footprint }], density, { seed, avoid, boundaries, boundaryDensity })`
    returns clustered dressing, denser near `boundaries`; pass the path, door entry and building cells in `avoid`.
    Solid items go on the `wall` layer so they block movement at their origin cell.
  - Concatenate the placements with the scene's floor and pass them to `assemblyMap(width, height, placements)`, the
    Tiled subset `IsoMap` reads. Mark an opening's floor placement with `tags: ['gate']` for scene verification.
    A placement's optional `depthOffset` adjusts its projected sort key in pixels without changing position or collision;
    it must be finite and is zero on floor tiles. Scene conversion and editor drawing preserve it.
    The structural asset ids are pinned card ids; record them in the game's asset list.
  - Not bound yet: other gate orientations, steps and other building styles.
- `scripts/stage-structural-cards.mjs <library> <empty-dir>` (after `pnpm build`) writes validated card copies carrying
  the structural facts and a source-hash plan, for a host operator to apply to the shared library.
- `structuralImageBounds`: inclusive alpha bounds for measured structural or paving assets, keyed by asset card id.
  Bounds do not establish an anchor or connection socket. `fenceB1Edges`, `wallF1Edges`, `wallF6Edges`, `wallC1Edges`, and `wallC6Edges` record measured fence, stone wall, stone arch, timber wall, and timber opening facings.
  `structuralCardFacts(id)` returns the known card fields without fabricating unmeasured facts.
- `vocabulary`: canonical roles to this set's action names, and the loop set.

## Leaves to the game

- Which sheet is the player, and which role a button plays.
- Movement, speeds and the hysteresis width.
- Combat, hit boxes and damage; doors, chests, inventory, dialogue and HUD.
- Door, destructible and roof-cutaway policy; the adapter only consumes generic visibility/solidity state.
- Physics, movement, pathfinding and a map-painter UI (the brush UI drives `TerrainMap.paint`/`undo`/`redo`).
- Which terrains a game uses and their order; which decals scatter on them.

## Verified

`pnpm --filter @gm/pack-smallscaleint test` draws numbered synthetic 128 px and 64 px sheets, checks every action,
direction and frame lands on its cell, exercises a generated 4×4 map, and checks the shared edges of a 2×2 floor
using a committed diamond and, when available, a library tile. Playwright renders the floor and an actor through
Phaser WebGL and checks Canvas rendering and the four facing textures.
Terrain: six seeded maps check every quarter has an opaque bottom piece and a sheet frame, quarters around a vertex
share one corner tile, edges vary, collision stays per cell, and brush strokes undo exactly. Playwright draws a
six-terrain map in WebGL and Canvas with no uncovered pixel and repaints a cell live, then undoes it; with the library
installed it also writes before/after phone stills of five scene layouts to the local review folder.
