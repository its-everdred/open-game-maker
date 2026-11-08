# @gm/pack-kaykit

Adapter for the KayKit 3D set (three + Rapier). It reads rig, kit and geometry facts from the asset manifest's
`meta` through `@gm/sdk/assets`, never from pack files, and ships no asset bytes.

## Binds

- `createRiggedCharacter(loader, gltf, id, { clipLibraryIds, crossFade })`: the character `.glb` plus the
  `Rig_Medium_*`/`Rig_Large_*` libraries it may play, retargeted by rig id (refused, with the joint named, when a
  clip drives a joint the character lacks, or when the library is for the other body). `sync({ pos, yaw, action, t })`
  poses it; `action` is a role from `vocabulary` or a clip name; loop clips repeat, the rest play once and hold.
  `contactFrame(action)` answers once a still has verified the frame.
- `createKitPlacer(loader)`: `snap` to the piece's `kit.grid_m` in 90° steps, `footprint`, and `colliderFor` (a
  cuboid from `geometry.bounds_m` for solid pieces, `null` for floors and props unless the game asks).
- `kitPiece(loader, cardId)`: the card's own mesh from a packed kit file (three strips `:`, `/` and `.` from node
  names, so a lookup by card id would draw the file's first piece), with the node's meshopt dequantization baked into
  the geometry so a placement can set position and scale freely; a card with several materials comes back as one mesh
  with a material per group.
- `parseKitMap` / `writeKitMap`: the Tiled JSON subset kits are authored in (orthogonal, a `grid_m` map property,
  `asset` tile property, rotate flags or object `rotation` as turns, `z` property as height); `kitPalette(manifest)`
  lists what may be placed.
- `conventions`: the pack facts, each with how it was verified; `vocabulary`: the shared roles to KayKit clip names.

## Leaves to the game

- Which character is the player, and which role a button plays; cross-fade length.
- Character controller, gravity, camera rig, speeds; combat, hit boxes and what `Interact` does.
- The Rapier world: the game builds colliders from the descriptions.

## Verified

`pnpm --filter @gm/pack-kaykit test` builds skinned meshes and clip libraries in the test (one with a renamed joint)
and checks retarget, loop and hold, cross-fade, snapping, colliders and map round trips; `kitPiece` is checked on
kit files packed with meshopt as `gm build assets` packs them. `test:browser` renders a
retargeted idle on the GPU flags and saves the still.
