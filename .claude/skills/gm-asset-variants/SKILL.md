---
name: gm-asset-variants
description: Use when a game or scene needs an asset the library doesn't have exactly, or the library's few models start to look repetitive (a taller tower, a shorter one, a building on a podium, a recolour, a combined prop), or when Kevin asks to "make a variation", "remix", "augment" or "update" an existing model, sprite, sound or texture. Makes the variant from a cloned copy, never from or over the original, records where it came from, and checks it by eye.
---

# gm-asset-variants (draft)

Starting from an existing resource and making a variation of it is a normal step in building a game, not a workaround. This skill covers how to do it safely and traceably. The first working example is the archived city title source: `apps/web/title-town/tools/variants.mjs` and `apps/web/title-town/tools/variants.html` make 43 building variants from Kenney City Kit models.

**Hard rules (Kevin, 2026-10-30)**
- **Never delete, edit, overwrite or re-save an original resource file.** That covers everything under `assets-local/packs/*/*/originals/` and `extracted/`, and every copy a game loads as a source.
- Always work on a clone. A variant is a **new file** in a variants folder, never next to or in place of its source.
- Every variant gets a manifest entry that says what it was made from and how, so it can be rebuilt or traced back.
- Variants inherit their sources' usage rights. A variant of a CC0 model is fine anywhere. A variant of a licensed pack (Synty, Sidetrax) stays under that pack's rights: personal use, never redistributed as a standalone file (see the asset card's `usage_rights`, C3 §5).
- No cloud processing of paid assets. Variant tools run locally.
- **No hand-made parts on pack models (Kevin, 2026-11-10).** Every added piece (a beard, a hat, a held prop) is a part from an installed pack in the same set (`gm assets search --set <set>`; KayKit has 20+ bits packs). Shapes built from primitives in code read as "agent-made" next to the pack's art (Blobs #149: a box beard and a teapot on the KayKit mage). If no pack part fits, change the concept to what the packs have; never model one.

## Where variants go

- **In a game or prototype:** `<project>/models/variants/` (or `sprites/variants/`, `audio/variants/`), plus `manifest.json` in the same folder.
- **For the shared library**, once a variant earns reuse: `assets-local/variants/<source-pack>/<name>` with the same manifest fields. `build_catalog.py` should list it with `derived_from`.
- A manifest entry looks like `{ name, set, op, from: [source paths], params..., size }`. The file also carries a `note` and a `made` date. Sources are paths relative to the models folder, never absolute.

## The loop

1. **Look first.** Search the catalog (`gm assets search`, or `assets-local/catalog.json`) for something close. A variant is justified when the closest asset is near but wrong: the wrong height or footprint, too repetitive in bulk, the wrong colour family, or missing a part.
2. **Pick the cheapest operation that gets there:**

   | Operation | What it does | When |
   |---|---|---|
   | `stack` | Keep the base and top, repeat (or remove) the middle floors. Triangles crossing a band edge are stretched. | Towers, walls, fences, anything with repeating bands |
   | `podium` | Set one model on top of another, scaled to the roof | Skyline variety, landmark buildings |
   | combine | Merge parts that share a texture (props on roofs, two halves) | New props from a kit's parts |
   | recolour | A **cloned** colour-map texture with swatches remapped to a palette | Keeping a palette across packs |
   | mirror | Flip on one axis (reverse triangle winding) | Cheap asymmetry |
   | audio | Trim, loop-point, pitch or filter a **copy** of the file | SFX families, music loops |
   | sprite | Palette swap or recolour a **copy** of the sheet | Pixel-art enemies, items |

   Prefer runtime tinting in the shader when that's all the variant does: one tint per instance costs nothing and needs no file. Make a file when the geometry, texture or timing changes.
3. **Write the generator, not the file.** Add a spec to the project's variant script (`tools/variants.mjs` in `apps/web/title-town`): name, set, op, from, params. Running the script rebuilds every variant from the sources, deterministically.
   - The script must refuse to write to a path that is a source.
   - A rebuild never redoes finished work: skip a variant whose output is newer than every input it names, and only `--force` rebuilds everything. A batch that redoes 43 models to change one is how a set stops being cheap to iterate.
   - three.js runs in headless Chromium (`variants.html` with `GLTFLoader` and `GLTFExporter`) because the loader and exporter need a browser. Use `--use-angle=gl-egl --enable-gpu` for the Intel GPU.
4. **Keep the set one world.** Write the set's style in one paragraph once — era, palette, materials, wear, and the level of detail — and put it beside the variant specs, so every variation is judged against the same words instead of against the model it happened to start from. When two candidates could serve, render them under the same light in one image and pick by looking; record one line saying why the pick won. Cohesion is decided here, before the game mixes the set, and it is the cheapest place to fix it.
5. **Check by eye.** Render a lineup of each variant next to its source (`tools/lineup.html?set=...` in `apps/web/title-town`). Read the screenshot and look for:
   - seams where bands meet;
   - floating parts, missing faces, inside-out faces;
   - the scale against the source.

   - **style:** a close-up at 2x play size beside an untouched character from the same pack. Pass only if someone who hasn't seen the source can't point at the added parts (shading, bevels, palette, proportions).

   Fix the worst problem and rebuild. Don't ship a variant you haven't looked at.
   Then check the whole set in proportion, not one row at a time: `python3 -I scripts/assets/check_glb.py --lineup models/variants/*.glb` prints the to-scale positions and a scale bar for the lineup still. The same command without `--lineup` fails a variant that stands off its origin, is the wrong real height (`--height`), or blows a triangle or texture budget (`--budget`).
6. **Use it.** The game loads `models/variants/manifest.json` and adds each variant to its set (the title prototype's `addVariants()`). Variants then mix with originals at random, so neither looks repeated.
7. **Report.** One line per batch: how many variants, which sources, which operations, where the files are, and anything that didn't come out clean.

## Gotchas

- **Kenney colour maps are gradient swatches** (the U axis picks a swatch, V runs along a gradient). Kevin disliked the gradient look on buildings. The title prototype samples the swatch's left column for one flat tone per surface. A recolour should remap whole swatches, not individual pixels.
- **Band detection** picks the floor lines with the most vertices near 30% and 72% of the height. Check the lineup for models with odd floor heights, and set the bands by hand in the spec if they look wrong.
- **Merged geometry must share one texture.** You can't merge parts from two kits with different colour maps into one mesh. Keep them as two meshes in the same GLB instead.
- **Instancing:** variants become ordinary models, so the game instances them like any other; there's no extra draw-call cost per copy.
