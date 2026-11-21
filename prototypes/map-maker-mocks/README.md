# Map maker mocks (issue #1191, step 1)

Kevin's asks (2026-11-21): build and finish maps himself, and open every agent prototype (the Dusk Helm village and
graveyard) in the map maker to make the final changes, with fences and walls that connect.

These pages are UI mocks drawn from the real app shell's tokens (`apps/web/src/tokens.css`, `editor.css`) and
SmallScaleInt sprites. They are discussion pictures, not product code.

## The editor today, on Dusk Helm

Captured with the app shell's capture runner on Dusk Helm's graveyard branch (open-games PR #751) at four
sizes. Stills live in `assets-local/review/1191/editor-now*/`; they are not committed.

| Need | Today |
| --- | --- |
| Open a Dusk Helm scene in the editor | No. Dusk Helm's manifest has no `capabilities`, `tools` or `palette`, so the game menu has no Edit button. Forcing `?mode=edit` opens the edit workspace with the game ready, but no editor chrome renders: 0 palette items, 0 tools. |
| Place pack sprites | Only prefabs a game lists in its manifest palette. There is no browser over pack cards (SmallScaleInt kinds or packs). |
| Grid | Snap rounds to a world-unit grid. There is no isometric tile grid (cells, edges, vertices). |
| Rotate and flip | Rotation is a 3D yaw gizmo. Iso sprites need their four drawn facings (N/E/S/W); there is no flip. |
| Layers | None. Both prototypes are Tiled-style iso maps with `floor`, `wall`, `decor`, `roof` tile layers and a `spawns` object layer. |
| Fences and walls connect | No autotile. Each piece is placed alone with a fixed facing. |
| Undo, redo, select, delete, duplicate | Yes (design-log transactions), reusable as is. |
| Ground painting | Terrain strokes exist (grass, path, water) for 3D terrain. The stroke pattern can drive tile painting. |
| Edits save back into the game | Not for these prototypes. The village (`village.ts`, `tiled.ts`) and graveyard (`graveyard-map.ts`) are maps written as TypeScript. The editor has no map file to write to, so Kevin's edits have nowhere to go. |

The graveyard's fence is code: `graveyard-map.ts` picks one hard-coded facing per boundary edge and squeezes a
corner's second piece into the `decor` layer, which it shares with trees and graves. Nothing derives a piece from its
neighbours, so a fence that looks wrong can only be fixed by editing code. A map maker that keeps fences on tile
edges and picks each piece from its neighbours makes them connect by construction, and lets Kevin fix one by hand.

## Fences can autotile with the pack's own art

The rural tileset's fences are 128x256 HD tiles whose bottom 64 px are the tile diamond. Each facing draws one tile
edge: `W` the y-min edge, `S` the x-min edge, `N` the x-max edge, `E` the y-max edge. Straight runs on adjacent edges
meet at the vertices with no gap (checked by rendering a closed 3x3 yard). Corner art exists: `B4` and `B6` in all
four facings (iron on stone), plus the `A6` post to cap wooden runs. So autotile is choosing the facing from the
edge and a corner piece where two edges meet; no new art is needed.

## Three layouts

All three show the same graveyard built from pack sprites, a fence being drawn, and undo, redo and save.

- **A: Bottom tray.** Phone first. The tools sit in a pill above a tray of sprites grouped by kind (ground, fences,
  walls, props, nature, characters). A selected piece gets a floating rotate, flip, duplicate and delete bar.
  Dragging the fence tool draws a run that joins the fence it touches.
- **B: Studio panels.** Desktop first. Sprites by pack with search on the left, layers with show and lock on the right,
  dashed tile grid with snap. On a phone the panels become rails and the map gets small.
- **C: Brushes.** Paint first. A row of big brush buttons (grass, paving, iron fence, wooden fence, wall, graves, trees,
  characters), each with a small strip of variants. Layers are automatic (the brush knows its layer); an eye button
  sees through roofs.

## Decisions for Kevin

1. Layout: A, B or C.
2. Placement: snap to the tile grid, or freeform.
3. Fences and walls: drag a line, or tap tile by tile (both connect automatically).
4. Agent prototypes: Kevin's edits are locked and agents build around them, or agents may keep changing the
   whole map.

## Render

```sh
OGM_BLOB_ROOT=<blob store> ./stage-sprites.sh   # copies the sprites into ./sprites (gitignored)
node capture.mjs <out-dir>                      # phone 390x844 and desktop 1280x800 per layout, plus the decision stills
```
