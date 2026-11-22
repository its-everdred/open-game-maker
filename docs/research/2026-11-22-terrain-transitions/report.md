# Terrain transitions for the SmallScaleInt isometric ground (#1200)

Spike for Kevin's 2026-11-22 review: the ground is large blocks of grass, dirt or stone with hard diamond edges. Which
transition scheme should the pack adapter use? The follow-on build (#1204) is held until Kevin picks a layout.

**Recommendation: A, a dual-grid 16-piece corner set, layered by terrain priority.** It needs the fewest tiles (15 per
terrain, not per pair), handles three or more terrains meeting at a corner, and keeps the map data per cell, so the
map-maker brush, collision and seeded generation stay as they are. **B, the 47-piece blob set**, is the runner-up: its
edges follow cell borders more faithfully and it reuses the #186 autotile code, but it needs about three times the
tiles and makes one-cell paths look thin.

## Approval sheet (temporary experiment tiles)

Rendered at 1x (real 128x64 tiles), one 768 px column for the phone, from a 10x10 test map with six terrains: dirt, dry
grass, grass, dark grass, a cobble path and stone paving. Two terrains are grass shades, and the map has corners where
three terrains meet. The files are local only, because the pack's licence is `processing: local-only` and its art stays
out of git:

- `assets-local/sets/terrain-transitions-spike/2026-11-22/approval-sheet.png`: Now, A, B and C stacked, same map
- `options.mp4`: the same four views, 3 s each, for the phone
- `layout-a-dualgrid16.png`: all 16 corner cases, grass over dirt and stone over grass
- `layout-b-blob47.png`: all 47 blob cases, grass over dirt
- `scene-*.png`: whole map per scheme; `phone-*.png`: the crops used in the sheet
- `metadata.json`: source tiles, method, counts, `experiment: true`, `ai_generated: false`

Every transition tile on the sheet is a **temporary experiment**: a procedural numpy mask (noise edge, 1–2 px drop
shadow) cut from cloned pack top faces. None are production art. They are made by
`docs/research/2026-11-22-terrain-transitions/spike/render.py`, which reads the pack and never writes to it:

```sh
python -I docs/research/2026-11-22-terrain-transitions/spike/render.py \
  assets-local/packs/smallscaleint-fantasy-tileset-2d-isometric/2026-11-01/extracted/Environment \
  assets-local/sets/terrain-transitions-spike/2026-11-22
```

It needs Pillow and numpy, about 10 s on one core.

## What the pack already has (measured)

The `Ground` art is a dirt block (`Ground A1`, a 128x64 top face over a 15 px side) with flat overlays drawn on top. The
sizes, bounding boxes and per-corner coverage were measured from the alpha channel of all 135 `Ground`/`Stone` tiles in
each of their 4 rotations.

| Family | Pieces | What they are as transitions |
|---|---|---|
| Grass `A2–A5`, dry grass `J1–J4`, dark grass `A18–A21` | full, one-edge (`A4`, `J3`, `A20`), two-adjacent-edges (`A3`, `J2`, `A19`), ring with a dirt hole (`A5`, `J4`), each in N/E/S/W | **edge-based Wang pieces over dirt**: 10 of the 16 two-edge cases per grass type (empty, full, 4 single-edge, 4 adjacent-pair). Missing: the 2 opposite-edge and 4 three-edge cases. They don't line up at corners: a one-edge piece covers 54–71% of the corner beside its edge, so diagonal neighbours leave notches. |
| Tufts `A6–A9`, `A10–A12`, `J5–J8` | scattered grass clumps | decals, not transitions |
| Stone paving `H1–H8` | full paving plus irregular stepped fragments | fragments in fixed shapes; they don't meet a neighbour along a shared edge, so they can't serve as transition pieces |
| Cobble `E1–E9` | full plus scattered stones | full piece plus decals |
| Dirt blocks `B`, `C`, `I` | dirt variants, pits, rubble | fills |

No `Stone`/`Ground` piece covers stone↔grass, stone↔dirt, cobble↔anything or grass↔grass shades. **Whichever scheme
is picked, every transition tile is new.** The tiles are cut from pack textures, so their pixels stay in the pack's
style. The pack's own edge pieces are useful as references for production edge style (an irregular tufted fringe
overhanging the dirt), and the tufts and pebbles as decals.

## Candidates compared

Our set needs 6 terrains, and 9 pairs are essential: grass↔dirt, stone↔grass, stone↔dirt, grass↔dark grass,
grass↔dry grass, dark grass↔dirt, dry grass↔dirt, cobble↔grass and cobble↔dirt. All 15 pairs are reachable once a
brush can paint anything next to anything. Counts are tiles without variants (×3 with the 3 noise variants the sheet
uses).

| Scheme | Tiles per pair | 9 pairs | All 15 pairs / layered | 3 terrains at one corner | Notes |
|---|---|---|---|---|---|
| Pack-native edge pieces | 10 of 16 exist (grass types only) | — | — | no | incomplete; corner notches |
| 16 two-edge Wang | 14 + 2 fills | 126 | 210 | no (per-pair) | no inner/outer corner pieces, so diagonals read as notches |
| 16 two-corner Wang / marching squares (cell grid) | 14 + 2 | 126 | 210 | no (per-pair), unless 3-terrain tiles (81 per triple) | corner data on cell corners: the brush paints vertices, not cells |
| "32-tile" | ~30 + 2 | ~270 | — | no | no single standard; the usual 32-piece layouts are subsets of 47 and leave cases missing |
| **A. Dual-grid 16, layered** | — | — | **15 per terrain → 75** for 6 terrains | **yes** (priority) | data stays per cell; display tiles sit on cell corners |
| **B. 47 blob, layered** | 46 + fill | 414 | **46 per terrain → 230** | **yes** (priority) | #186 already implements the lookup for limezu |
| Quarter-tile (RPG Maker A2 style) | 20 quarter sprites (5 kinds × 4 quarters) | 180 | 100 per terrain layered | yes (layered) | builds the 47 cases from 4 draws per cell; the iso quarter diamonds are 64x32 |
| C. Splat mask shader | 0 | 0 | 0 (6 textures + noise) | yes | WebGL-only custom pipeline; the adapter's Canvas path would need a baked fallback |

"Layered" means terrains are ordered (dirt < dry grass < grass < dark grass < cobble < paving) and each one is drawn as
an overlay over everything lower. The overlay tile depends only on which of the 4 (A) or 8 (B) neighbours are the same
terrain or higher. So tiles scale with terrains, not pairs, and any mix of terrains at a corner resolves. In the 100-cell
test map, A used 56 distinct (terrain, case) pieces and B used 58.

### Runtime and editor complexity

- **Lookup**: A reads 4 cells per display tile per terrain layer (a 4-bit index). B reads 8 per cell (an 8-bit blob
  index mapped to 47 pieces, as `blobMask` does in `@gm/pack-limezu-modern`). Both are pure functions of the cell grid.
- **Draw order**: all ground stays on the floor layer at depth −1. The overlays are extra tile layers stacked inside the
  floor, so walls, trees and actors keep their current depth sort. A has one more row and column of display tiles than the map; B has as many tiles as cells.
- **Brush (#1191)**: both paint cells, as the map maker does now. One painted cell updates 4 display tiles per layer
  (A) or 9 cells (B). Undo stores cell values only. In A the transition straddles the painted cell's border; in B it sits
  inside the painted cell. That's why B's one-cell paths look thin and A's look like a chain of rounded blobs.
- **Shader (C)**: no tile lookup at all, but a custom Phaser WebGL pipeline, a weight texture per terrain, and a separate
  Canvas fallback.

### Reuse without visible repetition

- Masks are shared across terrains (A: 15, B: 46). The pack fills and seeded noise variants (3 per case on the sheet,
  picked by a hash of cell and layer) keep the same edge from repeating along a long boundary.
- Decals work with every scheme: the pack's tufts (`A6–A9`, `J5–J8`) and stones (`E2`, `E3`, `E6`) in 4 rotations,
  scattered by a seeded hash. Tint (`setTint`) could derive the grass shades from one texture, but the pack already
  ships them.
- Repetition still visible on the sheet: the pack's fills repeat every cell (the dark grass shows a faint diamond
  rhythm). That comes from the pack textures, not from the scheme; per-cell fill variants (`I1–I10` for dirt) would
  fix it at the same cost in every scheme.

### Compatibility

- **Seeded generation (open-games #7)**: unchanged. Generators emit a terrain id per cell, and both A and B derive the
  tiles deterministically, with variants from `hash(seed, x, y, layer)`.
- **Collision and walkability**: they stay per cell. On the sheet, A's visible boundary stays near the true cell border (by eye); B's terrain looks up to 30% smaller than its cells (the test map's margin). For "can I walk on
  stone", A matches what the player sees better.
- **Pack adapter (`@gm/pack-smallscaleint`, #184)**: `IsoMap` has one floor tile layer today. Either scheme adds a
  `terrain` cell layer (a Tiled layer with a property, the same pattern as the limezu `autotile` layer) and resolves it
  into stacked floor overlay layers, so nothing game-specific moves into the adapter.

## Tradeoffs in one line each

- **A dual-grid 16**: fewest tiles and organic edges. Straight one-cell paths come out wavy and blobby.
- **B blob 47**: crisp, cell-faithful edges and reuses the #186 code. About 3× the tiles, and thin paths.
- **C shader splat**: no transition tiles and the smoothest blends. It's WebGL-only, needs the most engine work, and its
  edges are harder to art-direct pixel by pixel.

## Asked of Kevin

Pick a layout for #1204: A (recommended), B, or C. Without an answer, #1204 stays held and no production sheets are
made.
