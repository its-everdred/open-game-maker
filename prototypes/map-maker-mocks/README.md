# Map maker mocks (issue #1191, step 1)

Kevin's asks (2026-11-21, widened 2026-11-22): a reusable map maker in OGM core, proven on Dusk Helm. He edits the real
shared scene; the agent takes his edit as the new baseline and keeps going without overwriting it. It must handle a huge
asset library, terrain and autotile, HD-2D light, blur and particles, and list every agent scene.

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

## Three directions

Each direction is drawn in four states, phone portrait first and desktop: **edit** (placing, a fence being drawn),
**browse** (the library open, a tree dragged onto the map), **scenes** (moving between the agents' and Kevin's scenes)
and **look** (HD-2D: night, torch light, focus blur, fireflies). Ideas taken from the Goblin Cellar editor
(`docs/research/v0.5/C1-ui-prototype-learnings.md`: top bar with undo, redo and Try it, category rail, thumbnail tray,
inspector as a phone bottom sheet, play never changes the map) and from accessible level editors in general (big touch
targets, one-tap tools, instant test play, undo always in reach). No assets or UI are copied.

| | A: Bottom tray | B: Studio panels | C: Brushes |
| --- | --- | --- | --- |
| Toolbar | Undo, redo, test, save on top; tools in a pill above the tray | Tools across the top on desktop, a left rail on phone | Top bar only; a few tools on the right |
| Controls | Bottom (thumb reach) | Sides on desktop; rails and a sheet on phone | A ring of big brush circles at the bottom (phone) or left (desktop) |
| Library | Tray pulls up into a sheet: search, kind chips, finer chips, labelled thumbnails; drag onto the map | Left panel: search, kind › sub-kind path, tag chips, labelled grid | Full-screen picker of brush circles by kind; drag one into the ring |
| Placement | Tap or drag; selected piece gets rotate, flip, duplicate, delete | Grid with snap toggle and ghost preview | Paint with the active brush; variants in a strip above |
| Layers | A layers tool | Layers panel with show and lock | Automatic; an eye sees through roofs |
| Scenes | A strip of scene cards under the top bar | Scene tabs on desktop, a drawer on phone | A world map: scenes as cards joined by their paths and doors |
| HD-2D look | A sun tool turns the tray into four big controls with sliders | A Look tab beside Layers | Light brushes: paint lights, drop a focus pin, a slider for strength |

Every scene card shows who changed it last (Kevin or an agent).

## Render

```sh
OGM_BLOB_ROOT=<blob store> ./stage-sprites.sh   # copies the sprites into ./sprites (gitignored)
node capture.mjs <out-dir> [file-prefix]        # four states per direction at 390x844 and 1280x800, plus the decision stills
```
