---
name: gm-set-smallscaleint
description: Load when gm.lock.json names the smallscaleint set and the game uses its isometric adapter.
---

# SmallScaleInt set route

Confirm `gm.lock.json` has `set: "smallscaleint"`. Inspect chosen cards with `gm assets info`, search with
`gm assets search --set smallscaleint`, and compare candidates with `gm assets sheet`. Fetch one implementation
pattern at a time with `gm docs pattern <topic>`.

Before you offer or build an option set, read `design/feedback.json`, the game's creator rejection ledger (#567), and
keep its rules in front of you. A rejected option never comes back: run `gm options check` on the set first, and record a
rejection you hear with `gm options reject`.

## Adapter exports

| Export | Use |
|---|---|
| `smallscaleintConventions` | verified grid, direction, footprint, and sequence facts |
| `smallscaleintVocabulary` | canonical action role to sheet sequence |
| `SpriteActor` | eight-direction sheet binding over plain state |
| `IsoMap` | Tiled isometric layers, wall collision, and depth |
| `LayeredSprite` | creator-piece composition using verified order |
| `smallscaleintPalette` | card-derived editor prefabs and placement checks |
| `smallScaleIntSceneAdapter` | scene-document facings, placement, snap, layers and brushes |
| `sceneToIsoMap` / `isoMapToScene` | scene document ⇄ the Tiled map `IsoMap` reads |

## Scenes are scene documents

Build every map as a scene document, never as a TypeScript map: the map maker opens scene documents, and Kevin's edits
to one come back to you on the next pull. Start one with `gm scene pull <game> <scene> --pack smallscaleint`, fill
its `doc` (`smallScaleIntSceneAdapter(cards).emptyScene(...)` gives the layers and `bounds`), and save it with
`gm scene push`. Put each piece on its layer as a tile keyed by cell (`"x,y"`) with a facing the adapter offers for that
asset; set `props.solid` only to override the layer default (walls block, the rest do not). Spawns are objects on the
`spawns` layer named `spawn-<id>`, posed in cells. The game loads `scenes/<scene>.scene.json` and draws it with
`new IsoMap(sceneToIsoMap(head.doc))`. Moving an old TS map: run its Tiled JSON through `isoMapToScene` once, push
the result, and delete the TS map.

Rows and per-frame folders are pack facts; do not infer them from file names in game code. Loop locomotion and idle
sequences; treat impact, use, and defeat sequences as one-shot-and-hold when the card says so. Keep shadow variants
consistent within one actor. Pieces taller than a cell are depth-sorted sprites, not floor tiles.

## Cards

| Need | Topic |
|---|---|
| stable overlap | `iso-depth-sort` |
| motion facing | `eight-direction-facing` |
| tile walls | `wall-collision-from-tiles` |
| terminal poses | `one-shot-and-hold` |
| isometric control | `iso-movement` |
| ambient motion | `wander-flee` |

The game still chooses roles, input actions, speeds, behavior, combat, inventory, UI, and story.
