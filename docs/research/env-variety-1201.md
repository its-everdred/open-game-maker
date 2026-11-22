# Environmental variety: SmallScaleInt set-piece inventory, gaps and pilot (#1201)

Kevin's voice review (2026-11-22) found the town, field, forest, cave and graveyard scenes sparse and repetitive. This
page records what the installed packs already offer, what each biome is missing, how each gap should be filled, what
a local pilot produced, and the fal estimate for the items only a new mesh can supply. Pack files, variants and
review media stay under `assets-local/` and are never committed.

## Inventory

`scripts/assets/env_variety_inventory.py` reads the three isometric environment packs (read only), groups every file
into items (one name in all its facings), measures each one and assigns a scene-dressing kind. The kind table is a
judgement made from the #486 contact sheets and is checked in with the script. Output:
`assets-local/sets/env-variety/inventory/` (`inventory.json`, `INVENTORY.md`, one contact sheet per kind).

INVENTORY_TABLE

What the numbers mean for variety:

- **Every fantasy and desert set piece already ships N, E, S and W** on the pack's 256×256 canvas with the ground
  anchor at (128, 208). No existing item needs a new viewing angle; the fal route is only for objects no pack has.
- **The desert tileset is a warm-palette twin of the fantasy tileset.** Its same-named sprites keep the geometry
  (`Stone A1` differs by 4 alpha pixels, `Wall D1` by none) and recolour it to sand and ochre; a few are swapped
  outright (oak → palm, pine → cactus, green shrub → orange scrub). It also adds sandstone architecture
  (`Wall H`–`K`), sandstone pillars and a dune (`Stone B`), agave (`Flora C`), thorny bramble roots
  (`Misc B62`–`B66`), animal bones and a horned skull (`Misc D6`–`D8`) and a dead tree (`Tree E6`). Several of these
  fit green biomes directly (brambles, bones, dead tree) and the orange scrub reads as autumn growth. Both packs carry
  the same vendor licence (`LicenseRef-smallscaleint-itch`).
- **The HD rural tileset does not mix.** It reuses family names with other meanings (its `Wall B` is a house wall),
  uses other canvases (128-wide ground, 256×512 trees) and a modern, higher-detail style. The inventory classifies it
  by family only; treat it as reference, not as scene material for the fantasy biomes.
- **Fauna** comes from the animals mega pack: 55 species in 8 directions with Idle, Walk, Run, Attack, Die and
  TakeDamage (deer, boar, bear, wolf, sheep, cow, pig, chicken, horses, cats, dogs and others). It has no small
  ambient creatures (birds, crows, rabbits, rats, butterflies).
- Earlier generated variants already in the library: `sets/smallscaleint-generated` (market stall B17 v102, a weapons
  merchant and a rounded Stone A12) and the #1028 vegetation work.

## Gap list per biome

| Biome | Has | Missing for a natural, composed scene |
|---|---|---|
| Town | 570 wall/roof/door pieces, 10 market stalls and awnings, wells, carts, signs, benches, banners, crates, pots, barrels, hay | Grime: no alpha decals for dirt, mud, straw or worn cobbles (`Ground C`/`I` are whole tiles). Clutter: every crate stack, pot group and barrel is a single repeated sprite. Stall variety: three full stalls (`Misc B17`–`B19`). Fences: picket and rail runs have no broken, weathered or gate pieces. No lamp posts (only a wall torch). |
| Field | Grass and dry-grass tiles and patches, grass tufts, bushes, hay, rail fences, a training dummy, pebbles | Crops and tilled plots (none at all). Wildflowers (tufts are green only). Fence and hay variety. Grime and worn-path decals between route and grass. Rock clusters. Small fauna (crows, rabbits). |
| Forest | Three leafy trees, one amber, three pines, two bare trees, stumps, three log pieces, bushes and hedges | Tree variety is the biggest gap (8 tall trees repeat at once). Undergrowth: ferns, mushrooms, leaf litter and twig decals. Mossy rocks and boulder clusters. More fallen-log shapes. |
| Cave | Cliff walls and corners (`Ground G12`–`G22`), rock stairs, crystals, rubble rocks, pebbles | A cave mouth (#486 had to build a provisional one). Stalagmites. Wet floor and puddle decals. Bones. Mine props (beams exist in `Wall E`, no cart or rails). |
| Graveyard | Five gravestones and monuments (`Stone A4`, `A5`, `A13`–`A15`), a sarcophagus, cages, gallows, bare trees, dirt mounds (`Ground A14`–`A17`) | Gravestone variety (five shapes repeat): mossy, cracked, tilted. An iron fence run (only `Door C6`, one short railing). Open graves. Bones and skulls. Grave lanterns. A crypt entrance. |

## Variant plan

Route order follows the ticket: clone-based 2D variants first (recolour, recombine, scatter, cut, moss, decal; free,
local, pack pixels only), then local renders, then TRELLIS on fal for objects no pack has. Local renders are not
planned on this host: it runs at load average 60–90 on 12 cores and has no `gpu-run`.

| Gap | Items | Route | Source |
|---|---|---|---|
| Fences and palisades | broken, weathered, low-weathered palisade; picket run with a gap; weathered picket; rail-fence gate | 2D cut and recolour (piloted) | `Wall B1`, `B3`, `E16`, `B7`–`B11`, donor `Wall G1` |
| Iron graveyard fence | straight run, corner, broken run | 2D recombine and cut | `Door C6`, `Door C2` |
| Rocks | mossy boulders, rock clusters with pebbles and tufts | 2D moss and compose (piloted) | `Stone A1`, `A2`, `A12`, `Ground E11`/`E12`, `Flora A1`, donor `Ground A2` |
| Grime decals | dirt, mud, worn path, straw scatter, leaf litter | 2D decal (piloted for dirt, mud, worn path) | shapes `Ground A6`/`A7`/`A10`/`J9`; textures `Ground C2`/`C3`/`C5`/`I1`/`I6`, `Misc E` straw |
| Scattered clutter | pots and crates, farmyard, woodpile, market produce piles | 2D compose (piloted) | `Misc A`, `B1`/`B2`/`B8`, `E1`/`E9`, `Tree A4`/`E2` |
| Gravestones | mossy, cracked top, sunken | 2D moss and cut | `Stone A4`, `A5`, `A13`–`A15` |
| Stalagmites | grey stone pillars | 2D recolour | desert `Stone B1`/`B3` onto `Stone A` greys |
| Wildflowers | flowering tufts | 2D recolour of tufts onto pack flower and cloth colours | `Flora A1`–`A7`, donor `Misc B19` |
| Market stalls | awning and goods colourways | 2D recolour and recombine | `Misc B17`–`B19`, `B37`–`B40` |
| Autumn and dry growth | scrub, dry bushes | already in the desert pack | desert `Flora B`, `Ground J` |
| Bones, brambles, dead tree | as-is | already in the desert pack | desert `Misc D6`–`D8`, `B62`–`B66`, `Tree E6` |
| New trees | four new tree shapes | fal TRELLIS 2 → sprite forge finish (#1195) | Codex turnaround with a pack tree attached |
| New props | fern clump, mushroom cluster, cave mouth, mine cart, lamp post, wheat plot, cabbage plot, scarecrow, crypt entrance, grave lantern | fal Rodin 2.5 fast → finish pass | Codex turnaround with the nearest pack prop attached |
| Small fauna | crow, rabbit | fal TRELLIS v1 multi-view (characters) → static 8-direction sprite first, animation only after approval | Codex turnaround with an animals-pack sprite attached |

## Pilot

`scripts/assets/env_variety_pilot.py` rebuilds 17 variants for four gaps (palisades and fences, rocks, grime decals,
scattered clutter) from the fantasy pack, deterministically, into `assets-local/sets/env-variety/pilot-1/<id>/`
(`N/E/S/W.png` and `recipe.json` with sources, operation, model none, cost 0, `ai_generated: false` and the inherited
rights). No model, network or paid call is involved.

`scripts/assets/env_variety_validate.py` checks every facing against its sources: canvas and anchor (perspective),
colours drawn only from the named sources (pixel density and palette), ground contact against the primary source,
visible scale and canvas clipping; it also records `score.py --gates prop` against the primary source. The prop
gates measure a rebuild's fidelity, so a deliberate variant is expected to fail silhouette and pixel similarity; the
style numbers to read are palette distance and the luminance histogram.

VALIDATION_TABLE

Review in engine: `scripts/assets/env-variety/lineup.mjs` renders Dusk Helm's merged fields map
(`src/features/fields/map.ts`, 9×9, Dusk Helm's camera and dry-grass jitter) through the real `IsoMap` adapter in
Phaser on the GPU, and places the extra pieces with the adapter's own projection and depth rule
(`scripts/assets/env-variety/fields-plan.json`). Shots, phone (390×844 @2x) and desktop (1440×900):
`before` (pack originals, repeated), `after` (the same spots with variants mixed in, plus decals and clutter) and
`pairs-*` (each original on the left of its variant, one screen row per pair). Dusk Helm's dry-grass blob is not on
this host; the lineup rebuilds it from its recorded sources (`Ground J1` through the `Ground A7` mask). Media:
`assets-local/review/1201/round-1/`.

What looking found and fixed before review, worst first: mossy rocks read as grey and green static at play zoom (a
full rank map carried the rock's fine tone noise into the greens; now three greens in soft clumps); removing a
palisade stake cut the dirt mound and left a bare edge (now a broken stump stays); slivers survived in fence gaps (now
dropped); the mud decal closed into a flat rhombus; decals picked up the tile's side faces; a log ran off the
composition canvas; the pots pile included skeleton bones.

Known limits: shortened (not removed) stakes split neighbouring tips, so that operation was dropped; removed stakes
leave small shadow gaps; the worn-path decal keeps its source's straight diamond edges; composition facings rotate
the layout and each part's facing together, which reads correctly in the shots but has not been checked against a
character walking around the cluster.

## fal estimate (no calls made)

Prices are fal's listed prices recorded in the sprite-forge GPU guide (2026-11-21) and the routing is the creator's
verdict there: TRELLIS 2 for trees, Rodin 2.5 fast for props and foliage, TRELLIS v1 multi-view for characters.
Reference images come from the free Codex route with the pack original attached; fal never receives a pack file.

| Items | Endpoint | Each (USD) | Count | Subtotal (USD) |
|---|---|---|---|---|
| New tree shapes | `fal-ai/trellis-2` (512) | 0.25 | 4 | 1.00 |
| Fern clump, mushroom cluster, cave mouth, mine cart, lamp post, wheat plot, cabbage plot, scarecrow, crypt entrance, grave lantern | `fal-ai/hyper3d/rodin/v2.5/fast` | 0.10 | 10 | 1.00 |
| Crow, rabbit | `fal-ai/trellis/multi` | 0.02 | 2 | 0.04 |
| **Total, one mesh each** | | | 16 | **2.04** |
| With one retry for half of the items | | | | about 3.10 |

The ticket text says TRELLIS 2 is "about $0.02 per mesh"; the guide lists TRELLIS 2 at 0.25 and TRELLIS v1 at about
0.02. If Kevin prefers TRELLIS v1 for every item, the same 16 meshes cost about 0.32 USD, at the quality he judged
for characters rather than the one he picked for trees. The 9 USD host cap and ledger (`scripts/fal3d.py`) apply
either way; the calls run on the NUC after approval.
