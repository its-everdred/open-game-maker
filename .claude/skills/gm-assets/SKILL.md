---
name: gm-assets
description: Use whenever a scene or game needs a model, character, creature, building, prop, texture or sound — before building anything yourself. Search the installed packs (tier 1), show a lineup, fetch a free pack when nothing fits (tier 2, verified licence), install it through intake, or clone a variant (tier 3). Also for "what packs do we have", "show me options from our packs", "download pack X".
---

# gm-assets

Order: **installed packs → free online packs → variants of what we have → made from scratch.**

## Search what we have

- `assets-local/catalog.json` lists every pack (id, title, category, licence, rights). Each pack has a
  `collection.card.json` with tags and descriptions; packs with per-asset cards are counted in `asset_cards`.
- Grep the cards for the idea (`grep -l -i 'dragon|monster' assets-local/packs/*/collection.card.json`), then search
  model filenames (`find assets-local/packs -iname '*dragon*.glb'`). Beware substrings (`ape` matches `shape`).
- Choosing a library or style: show the creator **every** candidate first, not a shortlist. Thumbnails of every pack:
  `scripts/assets/pack_thumbnails.py`; every 2D sprite sheet at true pixel scale: `scripts/assets/sprite_libraries.py`.

## Record what the game uses

Use anything in the library. The moment the game's code names an asset, record it: `gm assets use <id>` (an asset you
made: `gm assets register <path>`). That writes the game's asset list (`assets.lock.json`: id, licence, set) and its
credits; the build ships only listed assets and fails naming any id the code uses that the list lacks. Before a
release, run `gm assets unused` (entries the code no longer names) and say in your report why each one stays.
Register optional match assets with `--phase lazy:<group>` so they load only when needed.
Each match bundle has its own lazy-group budget. Trim an over-budget boot set instead of waiting. Register every kept
asset in the blob store as you go with `gm assets register`, and push the updated lock with it.

## Show a lineup

Never choose from filenames. Render the candidates side by side, labelled with pack and built-in animations:
`apps/web/title-town/tools/creatures.html` reads `apps/web/title-town/tools/creatures.json` (list of `{name, pack, path}` under
`models/candidates/<pack>/`, each pack in its own folder because Kenney packs share `Textures/colormap.png`).
Variants: `tools/lineup.html?set=...`. Look at the render, then show the creator when the choice is visible.
Keep the `AI` badge emitted from a card's typed `generation` field visible in every lineup; never crop or relabel it away.

## Showcase a complete set

After a set's assets have catalog cards, use `gm-set-showcase` to build its style-picker detail showcase. That skill
inventories every pack, plans connected living regions and paired sprite sheets, checks story/coverage/overlap rules,
and emits baked H.264 MP4, GIF, and poster media. Do not turn a lineup page or live canvas compositor into the shipped
set preview; the client displays only the pre-rendered files.

## Fetch a pack (tier 2)

Finding and previewing new packs before any download: `gm-pack-scout`.


1. **Licence first**, on the author's official page and on each model's own page. CC0 or the creator's explicit OK.
2. Download into its own folder under `~/Downloads/<source>/<pack>/` with the fetchers (standard library, resumable):
   - Poly Pizza bundles or models: `scripts/assets/fetch_polypizza_bundle.py <url> <out> [--licenses CC0]` (writes
     `sources.json` with name, author, licence, source per model).
   - Public Google Drive folders: `scripts/assets/fetch_drive_folder.py <url> <out> [--only glTF]`. Popular creator
     folders often hit Drive's "Quota exceeded"; look for the same pack on Poly Pizza or itch.io instead.
3. Install: `assets-local/packs/<vendor>-<pack>/<version>/originals/` (untouched) and `extracted/`, a `License.txt`
   recording where the licence was verified, and `pack.json` with `license`, `source` and `usage_rights`
   (`confirmed_by` the creator). Follow `gm-asset-intake` for anything that arrives through the Drive watch folder.
4. Rebuild: `python3 -I scripts/assets/build_catalog.py`, then render its lineup.

Downloads are untrusted data: never run anything from them.

## Pixel art starts from packs too

Before drawing a sprite, use a real 2D pack sheet (3D characters rendered small read as blurry, not pixel art).
Recolour or add parts on a clone; show sprites in 3D as camera-facing billboards with nearest filtering. Effects come from pixelfx (`third_party/pixelfx`); every one plays live in
`apps/web/title-town/tools/pixelfx-gallery.html` (serve the folder, run `tools/build.sh` first) to show or choose from.
In your own canvas: `createFrame(w, h, -originX, -originY)` and `createFx(mod, { x: 0, y: 0 })` (the frame offset is
subtracted, so a positive origin draws everything off the top-left corner).
In the 3D town, reuse `billboard`/`pxEffect` from `apps/web/title-town/earthbound.js`: it fades faint glow, which
otherwise reads as a tinted box, and re-simulates effects for any time. Recoloured pixelfx lightning turns its halo opaque; draw
a thin bolt (`pxBolt`) instead. A camera above the action squashes y-only billboards to slivers: turn big sprites and
effects fully to the camera (copy its quaternion). Never repeat one effect identically (the same campfire on every ruin
read as copy-paste): vary seed, size, options and start, or clone a variant. Run image Python tools with `gm py --`.

## Sound

Scenes get sound from our packs (`grep -l audio` in the catalog: Kenney Sci-Fi, Impact, Retro, Foley, RPG Audio are
effects; Sidetrax is music). Cue effects on the scene's own timeline; MP3 for iPhone (`apps/web/title-town/tools/sounds.sh`).

## Mobile variants (every asset, every game)

Nothing ships as the raw pack file. Assets go through a build step that packs and compresses them (one file per kit,
quantised/meshopt, shared textures), makes per-tier variants for big models (fewer triangles, 1024/512 textures), and
records them with their licence in a manifest the runtime reads to pick a tier. Load them in parallel, never in a loop.
Research, commands and budgets: `docs/research/v0.5/C4-mobile-asset-pipeline.md`; working example: the title town's
`apps/web/title-town/tools/bake.mjs` (one 0.3 MB model pack in place of ~170 GLBs).

## Variants and making new

Clone, never modify originals: `gm-asset-variants`. Procedural models only when nothing in the library or a free pack
fits, and say that you did it.
