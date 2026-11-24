# Armor alternatives for the hero bodies (2026-11-24)

The best free route is Quaternius's CC0 outfits refitted onto our own bodies, with KayKit parts and MakeHuman robes filling the gaps.

- **Report not written:** the harness blocked `docs/research/2026-11-24-armor-alternatives/report.md`, so its full text is below.
- **Scripts:** in that folder, uncommitted: `kitbash.py`, `store_lineup.py`, `debug_render.py`.
- **Sheets:** in `/home/orangekid/games/open-game-maker-2000/assets-local/review/armor-alt/`.
- **Summary:** sent to main.
- **Spend:** nothing bought or downloaded. Store pages and images only, plus packs we own.

Kevin declined the [Polytope bundle](https://assetstore.unity.com/packages/3d/characters/humanoids/lowpoly-modular-armors-bundle-medieval-fantasy-series-230383) ($129.99). KayKit characters don't match the game; KayKit weapons and props do.

## Top 5

| # | Route | Cost | Classes | M/F | Fit to our bodies |
|---|---|---|---|---|---|
| 1 | **[Quaternius Modular Character Outfits Fantasy](https://quaternius.itch.io/modular-character-outfits-fantasy)**, refitted with free Blender tools | $0. The Source tier is **$20+**, not $15; needs approval | Free tier: Ranger and peasant. Source tier: knight plate, wizard, noble and templar tabards, covering all four classes | Yes | Refit |
| 2 | **Kitbash and shrink-wrap, owned or CC0:** KayKit helmets, hats, capes, pauldrons, quivers + MakeHuman CC0 robes and tunics | $0 | All 4 for head, back and shoulders; robes from MakeHuman | Any body | Shrinkwrap, then weight transfer |
| 3 | **[Polytope Lowpoly Modular Armors Free](https://assetstore.unity.com/packages/3d/characters/lowpoly-modular-armors-free-medieval-fantasy-series-199890)** | $0, Unity EULA | Warrior and Ranger only | 3 male + 3 female sets | Mixamo-ready, but needs a refit |
| 4 | **[SSI Character Creator Fantasy](https://smallscaleint.itch.io/character-creator-2d-fantasy)** 2D layers (owned) | $0 | Warrior and Ranger strong; 2 robes; no priest | **Male only** | None needed (2D, house style) |
| 5 | **Generate garments** from Kevin-approved concepts on fal: [TRELLIS 2](https://fal.ai/models/fal-ai/trellis-2), [TRELLIS](https://fal.ai/models/fal-ai/trellis), [Hunyuan3D v2](https://fal.ai/models/fal-ai/hunyuan3d/v2), or [Meshy](https://www.meshy.ai/pricing) | Needs Kevin's spend OK | Any | Any | One fused, unrigged mesh per call, then a refit |

**The best free route combines 1 and 2:**
1. Use the free Quaternius Ranger and Peasant outfits, male and female, as the leather and cloth tiers.
2. Fit them to our bodies with [Elastic Clothing Fit](https://github.com/VRC-Staples/Elastic-Clothing-Fit) for the shape and [Robust Weight Transfer](https://github.com/sentfromspacevr/robust-weight-transfer) for skinning. Both are free (GPL).
3. Fill the plate, robe and priest gaps with KayKit parts and MakeHuman CC0 robes, fitted the same way.
4. If the refit works, the $20 Source tier adds knight plate, wizard, noble and templar outfits.

### Can our bodies use the Quaternius outfits, or should we switch to its base?

- **The outfits don't fit our bodies as they are.** They are modelled and skinned on [Universal Base Characters](https://quaternius.itch.io/universal-base-characters) (CC0; free tier is one male and one female body plus 5 hairstyles; Source tier $19.99+).
- **The rig is compatible with our animation pipeline.** It uses the UE mannequin's bone names (`pelvis`, `spine_01`, `upperarm_l`, 65 bones). I checked this in our owned [Universal Animation Library](https://quaternius.itch.io/universal-animation-library), which ships the same rig. Those names map to Mixamo's.
- **Keep our bodies and refit; don't switch.** Universal Base Characters offers Superhero, Regular and Teen body types, and none of them is our scrawny Wizard. Switching would also throw away the approved Wizard and Ranger looks.
- **Middle path:** re-rig our bodies on the Quaternius skeleton. Every Quaternius outfit and animation then shares one bone set, and fitting only has to fix shape.
- **Paid fitting tools under $20, if the free ones struggle (need approval):**
  - [RadFit](https://superhivemarket.com/products/radfit--fit-any-outfit-to-any-body), $15: fits outfits across bodies and rigs.
  - [Outfit Refit](https://superhivemarket.com/products/outfit-refit), $19: reads Mixamo and MakeHuman bone names.

## Preview sheets

Each strip starts with our Warrior (facing S) and the pack Barbarian, standing on the SSI isometric ground in Dusk Helm daylight, built with `pixel_lineup.py`.

- **`1-quaternius-outfits-fantasy.png`** (store images):
  - The first 4 figures are the free tier: peasant and ranger, male and female.
  - The rest are Source-tier knights, nobles and templars.
  - They look like they belong with the Barbarian, and the male and female figures are easy to tell apart.
- **`2-kaykit-kitbash-on-our-bodies.png`**: real renders through `pixel_preview.py` (pack camera, approved pixel finish):

  | Body | KayKit parts |
  |---|---|
  | Warrior M | Knight helmet and visor, Knight cape, Barbarian_Large pauldrons |
  | Warrior F | Paladin helmet and cape |
  | Wizard M | Mage hat and cape |
  | Ranger M | Ranger cape and quiver |
  | Ranger F | Hooded-rogue cape and quiver |

  - The `2b-kitbash-fit-views.png` sheet shows each fit from the front, back and side.
  - **Verdict:** helmets and hats fit and read well at 43 px. Capes are stiff slabs and show only as thin edges from the front. KayKit chest and legs are part of the body meshes, so this covers head, back and shoulders only.
- **`3-polytope-free.png`** (store key image): a realistic look with a darker palette. Some background grass is left at the boots.

The store-image sheets show the look only. I scaled every figure to 43 px, so they prove nothing about scale or fit.

## Full survey

### Free and open

| Source | Licence | Format and rig | Classes and slots | M/F | Notes |
|---|---|---|---|---|---|
| [Quaternius Outfits Fantasy](https://quaternius.itch.io/modular-character-outfits-fantasy) | CC0 | glTF and FBX; .blend in Source tier; Quaternius humanoid rig (UE names) | 12 outfits, 62 parts (one caption says 82), 3 textures each | Yes | Free tier is Ranger and Peasant; Source tier $20+ |
| [Universal Base Characters](https://quaternius.itch.io/universal-base-characters) | CC0 | Same rig, about 13k triangles | Bodies and hair | Yes | Stylized, not chibi |
| [MakeHuman asset packs](https://static.makehumancommunity.org/assets/assetpacks.html) via [MPFB2](https://extensions.blender.org/add-ons/mpfb/) | CC0 ([Suits 02](https://static.makehumancommunity.org/assets/assetpacks/suits02.html), [Hats 02](https://static.makehumancommunity.org/assets/assetpacks/hats02.html)); CC-BY ([Suits 03](https://static.makehumancommunity.org/assets/assetpacks/suits03.html)) | .mhclo/.obj; fits only MakeHuman's own base body | Monk robe with 3 hood states (Wizard/Priest), viking tunic, pants and boots (Ranger), templar and Corinthian helmets (Warrior), wizard robe (CC-BY) | Yes | No mail, plate body or cloaks. Judged by asset names only |
| [Polytope Free](https://assetstore.unity.com/packages/3d/characters/lowpoly-modular-armors-free-medieval-fantasy-series-199890) | Unity EULA | Unity package; Mixamo-ready | 6 sets with helmet, cape and body slots | 3 M + 3 F | Warrior and Ranger only |
| [OGA Modular RPG Characters](https://opengameart.org/content/modular-rpg-characters) | CC0 | .blend 2.79, own rig | Light fantasy | 1 M + 1 F | The armour reportedly isn't skinned to the rig |
| [OGA Modular 3D male & female](https://opengameart.org/content/modular-3d-male-female) | CC-BY | Rig unverified | Bandit and scale armour | Yes | Textures are on a separate linked page |
| Sketchfab DevonLux sets: [Platemail](https://sketchfab.com/3d-models/d5a36fd5d69640b29bb7e92f72f61608), [Heavy](https://sketchfab.com/3d-models/38758fc7c96847d78dd5f6da4c3db1db), [Scalemail](https://sketchfab.com/3d-models/33858247654b47e68d26d6fdf070ca7f), [Leather](https://sketchfab.com/3d-models/4c10a03dbf3a440c943d383d664248c1), [Cloth](https://sketchfab.com/3d-models/2eb2ee83524545078252d87b33cd13dd), [Bandit](https://sketchfab.com/3d-models/8d22cf035d704bc89e13998ab6be6ec4) | CC-BY | Skinned to a MetaHuman (UE5) body; 95k–280k faces | Warrior plate and scale, Ranger leather, cloth | **Male only** | Best detail, but needs simplifying and re-skinning, plus attribution |
| Sketchfab [Medieval Knight Armor](https://sketchfab.com/3d-models/428913948904425e8daec81eea9aa287) and [Cape](https://sketchfab.com/3d-models/61e185ae00b640258071c581ab40f749) | CC-BY | Both rigged; the cape is weight-painted | Warrior; cloak for any class | Male / unisex | |
| [scoppio Fullplate Armor Knight](https://scoppio.itch.io/fullplate-armor-knight) | CC0 | .blend, FBX, GLB; simple rig | Warrior plate, one mesh | Male | Low-res PlayStation-1 look |
| Sketchfab CC0 results | | | | | Museum scans only: static and unrigged, useful as reference only |
| [LPC](https://opengameart.org/content/lpc-collection) | CC-BY-SA / GPL | 2D, 64 px top-down | | | Wrong camera and scale; not usable |

### Under $20 (each needs Kevin's approval)

- **[Quaternius Outfits Source tier](https://quaternius.itch.io/modular-character-outfits-fantasy):** $20+.
- **[Universal Base Characters Source tier](https://quaternius.itch.io/universal-base-characters):** $19.99+.
- **[JustCreate3D Low Poly Modular Fantasy Characters](https://justcreate3d.itch.io/low-poly-modular-fantasy-male-character):** $7.50 on sale until 2026-11-30, normally $15.
  - Contents: base, light armour, heavy armour and mage robes. The male is fully modular; the female is basic only. Listed as Mixamo-compatible.
  - Check the licence before buying. The same seller's [weapons Lite pack](https://justcreate3d.itch.io/low-poly-rpg-fantasy-weapons-lite) forbade AI/ML use, which conflicts with using it as a mock reference.
- **[Quin.GS Modular Knights](https://quin-gs.itch.io/knights):** $7.50. 68 parts, including 9 helms and 5 pauldrons. Male only; licence not read.
- **Fitting tools:** [RadFit](https://superhivemarket.com/products/radfit--fit-any-outfit-to-any-body) $15 and [Outfit Refit](https://superhivemarket.com/products/outfit-refit) $19.

### Fab and Unity Asset Store assets outside their engines

- **Unity Asset Store:**
  - The [EULA](https://unity.com/legal/as-terms) (Appendix 1 §2.2.1) has no Unity-engine requirement. Unity's [support article](https://support.unity.com/hc/en-us/articles/34387186019988) says assets "are not restricted to Unity projects".
  - The catch: the asset must be built into a larger product, and the raw files can't be redistributed. That would matter if Game Maker ever lets creators export assets.
  - "Restricted Assets" carry their own terms.
- **Fab:**
  - Its licence summary says use "is not limited to Unreal Engine" ([Fab EULA](https://www.fab.com/eula), [Epic docs](https://dev.epicgames.com/documentation/en-us/fab/licenses-and-pricing-in-fab)).
  - I found no free rigged male-and-female medieval armour set on Fab. The closest, [Modular Crusader Knights](https://www.fab.com/listings/b4550868-1132-4e2c-b5a2-eb8015d6d6d6), is $35.99 and male only.

### Blender tools

- **Free:**
  - Blender's built-in Shrinkwrap modifier (with an offset) plus a Data Transfer modifier for skin weights.
  - [Robust Weight Transfer](https://github.com/sentfromspacevr/robust-weight-transfer) (GPL-3): fixes the armpit and crotch problems of plain weight transfer.
  - [Elastic Clothing Fit](https://github.com/VRC-Staples/Elastic-Clothing-Fit) (GPL-3).
- **Over budget:** [Simply Cloth](https://superhivemarket.com/products/simply-cloth), $36, would drape robes and cloaks.
- **No free plate-armour generator exists** that I could find. [Plating Generator](https://blendermarket.com/products/plating-generator) makes sci-fi hull plating, not armour.

### 2D: SSI layers and female variants

- **What we own:** 19 chest, 23 head and 9 leg layers on one male body. The pack's other two bodies are undead and spirit.
- **We can't realistically draw the female versions ourselves.**
  - Each gear layer has about 3,600 frames: 30 animations × 8 directions × about 15 frames.
  - A female body would mean redrawing every chest, leg and hand layer to match it, frame by frame.
- **What works:** keep SSI as the house-style reference and the source of male NPC and enemy gear. Female heroes come from the 3D route.

### Beyond packs

- **Generation (close to the clone lane):**
  - Method: a Kevin-approved concept of one garment on its own goes into TRELLIS 2 or Hunyuan3D, then gets refitted and re-skinned.
  - Cost: about $6–9 for 24 garments (4 classes × 2 sexes × 3 tiers at $0.25–0.35 each), before retries.
  - Rules: no fal key is configured, spend needs Kevin's estimate and OK, and every output is flagged AI-generated in its metadata.
  - Meshy's free plan needs a sign-in, and its output is CC-BY with credit to Meshy.
  - No tool returns separate garments or a rig.
- **Kitbashing from KayKit:** proven above for helmets, hats, capes, pauldrons and quivers (CC0, owned). Weapons and shields come from the approved [KayKit](https://kaykit.itch.io) sets. Chest and legs can't be kitbashed.
- **Shrink-wrapping onto our bodies:** works for any garment above.
  1. Shrinkwrap with an offset.
  2. Robust Weight Transfer onto our rig.
  3. Check the fit in the idle and attack clips.

  Capes need a few extra bones or a baked cloth simulation so they stop looking like slabs.

## Not verified

- What Polytope Free contains (any robes?) and how its FBX files are laid out.
- Quaternius's per-outfit breakdown by slot and sex.
- How the MakeHuman garments look; only their names were checked.
- The JustCreate3D and Quin.GS licence text.
- Whether Elastic Clothing Fit copes with our TRELLIS meshes, which are high-poly and not watertight.

## Next step if Kevin picks route 1

1. After his pick, download the free Quaternius Standard zip (the preview-before-download rule).
2. Refit the Ranger outfit onto `ranger-m` and `ranger-f` with Elastic Clothing Fit and Robust Weight Transfer.
3. Render through `pixel_preview.py` beside the pack Barbarian.
4. If it holds up, ask him about the $20 Source tier.

Files are in `/home/orangekid/games/open-game-maker-2000/assets-local/review/armor-alt/`:
- 1-quaternius-outfits-fantasy.png
- 2-kaykit-kitbash-on-our-bodies.png
- 2b-kitbash-fit-views.png
- 3-polytope-free.png
