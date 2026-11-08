---
name: gm-asset-variants
description: Load when a scene needs an asset the library has nearly but not exactly (a recolour, a character holding a prop, a taller or shorter piece, a combined prop), or when the creator asks to make a variation, remix or update an existing model, sprite, sound or texture. Makes the variant from a clone, never from or over the original, records its sources, and checks it by eye.
---

# Asset variants

Making a variation of an existing asset is a normal build step, not a workaround. It is tier 3 in gm-core's asset
order: try installed packs and mirrors first, then vary a selected source before making anything from scratch.

## Hard rules

- Never delete, edit, overwrite or re-save an original. Library files and every locked source are read-only.
- A variant is a new file made from a clone. It never sits in place of its source, and a variant name is never reused.
- Every variant records what it was made from (`derived_from` in `assets.lock.json`), so it can be traced and rebuilt.
- A variant keeps its sources' rights. `gm assets register` refuses sources whose rights forbid redistribution; check
  `gm assets why <id>` before you start.
- Variant work runs locally. Never send a source asset to a cloud service.

## The loop

1. **Look first.** `gm assets search` and `gm assets info` for something close. A variant is justified when the closest
   asset is near but wrong: the wrong colour family, missing a held prop, the wrong height, or too repetitive in bulk.
2. **Lock the sources.** `gm assets use <id>` for the model and every prop, so each is sha-checked before it is read.
3. **Pick the cheapest operation:**

   | Operation | How | When |
   |---|---|---|
   | tint at runtime | one colour per instance in the material | the only change is colour; no file needed |
   | recolour | `gm assets variant <id> --name <slug> --recolour <material>=#rrggbb` | a palette shift that ships as its own model |
   | prop on a joint | `gm assets variant <id> --name <slug> --prop <prop-id>@<slot>` | a character holding a sword, a hat on a head |
   | stack, combine, mirror | a local script on a clone, then `gm assets register <path> --made-by-agent --from <id>` | new heights, merged parts, cheap asymmetry |
   | audio, sprite | trim, loop or palette-swap a copy, then register it with `--from` | SFX families, enemy palettes |

4. **Make one variant per command.** `gm assets variant` clones the locked glb, multiplies each named material's base
   colour by the sRGB hex (`*` means every material), parents each prop at the card's attach slot (`hand-right`,
   `head`) or a named rig joint, and registers the result as `t3:<game>/model/variants/<slug>`. Repeat `--recolour`
   and `--prop` as needed. It refuses an unknown material, slot or joint and lists the ones the model has.
5. **Keep the set one world.** Write the set's style once (era, palette, materials, wear, level of detail) and judge
   every variant against those words, not against the model it started from. When two candidates could serve, put
   them in one `gm assets sheet` lineup under the same light, pick by looking, and record one line saying why.
6. **Check by eye.** Load the variant in the game and take a still beside its source with `gm shot`. Look for floating
   or misplaced props, a prop at the wrong scale for the hand, seams, and colours that left the palette. Fix the worst
   problem and make a new variant under a new name. Never ship one you have not looked at (gm-verify).
7. **Report.** One line per batch: how many variants, from which sources, by which operations, and anything that did
   not come out clean.

## Gotchas

- Many low-poly kits use one shared colour-map texture per model. `--recolour` multiplies that whole material, so on a
  single-material character it tints everything; use a lighter colour than you think, or tint at runtime instead.
- KayKit rigs share joints across a character set. A prop on `hand-right` follows that joint's animation, so check the
  prop in a moving clip, not only the rest pose.
- Merged parts from two kits keep their own materials and textures; they stay separate meshes in one file.
- Variants are ordinary models: the game instances them like any other, with no extra cost per copy.
