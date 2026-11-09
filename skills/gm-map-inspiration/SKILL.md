---
name: gm-map-inspiration
description: Load for every map, level, dungeon, room network, or terrain build. Chooses layout inspiration agent-side, derives a new graph, and renders it only with the game's chosen visual set.
---

# Map inspiration

Map-source selection is agent-only. Never ask the creator to choose a map source, map pack or tileset. The creator may
choose player-facing consequences such as biome, landmarks, density, route shape, scale, and how exploration feels.
Translate those answers into search facts yourself.

## Read first

- The game spec's biome, features, scale, world structure, progression, spawn, goal, and accessibility needs.
- `gm.lock.json` for the game's chosen style family and set. That choice owns the rendered tileset.
- The relevant set adapter and the game-owned design files that define maps or levels.

## Choose a layout

1. Search **all inspiration collections** with `gm maps search --maps`, narrowing by biome, feature, scale, grid, room
   count, loops, secrets, and flow. Never filter map inspiration by the game's style family, set, pack, or vendor.
2. Compare the returned layout facts against play needs. Choose the source yourself; never turn candidates into a
   creator option or expose their ids, packs, previews, or paths.
3. Retrieve only the validated graph with `gm maps info <map-id> --json`. Do not open, copy, or ship the source image.
4. Derive a game-owned layout: resize, mirror, reorder, combine, or omit rooms and routes as the game needs. Inspiration
   supplies topology, not content or art. Check that the result is meaningfully adapted rather than traced.

## Render with the chosen visual set

Search compatible render material with `gm maps search --tilesets --type <style-set>` plus the derived map's biome,
features, and grid. If the exact set has no row, use the selected style family's adapter or variant workflow; do not use
the inspiration source's art and do not ask the creator to pick a different tileset. Escalate an unreachable required
set to the Executor as an asset blocker.

Use the set adapter for tiles, props, collision, terrain, and dimensions. A layout from a tabletop dungeon may become a
3D dungeon, a platform route, or a top-down room graph; only its abstract spatial relationships carry over.

## First-map gate

The scaffold's **first map** is not done until a test build generates it from a selected inspiration graph and the
chosen visual set. In the game-owned design record the source layout id, every transformation, and the tileset card id.
Do not record an image path or copy an inspiration file.

Before handoff:

- Verify spawn-to-goal reachability, every required room and landmark, all connection endpoints, and any promised loop,
  secret, lock, or alternate route.
- Run the game's `gm build`, `gm test`, and `gm run` gates and inspect the generated first map through gm-verify.
- Confirm the build manifest contains only assets allowed in-game and no inspiration image or source-map file.
