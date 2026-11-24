# Weapon packs for Dusk Helm, and rarity tiers

Kevin asked for this on 2026-11-24 at about 03:20Z. Two follow-ups shaped it. He wants priest and healer weapons covered too. And on seeing the first sheets he said "kaykit looks best so far", so KayKit leads the recommendation.

Everything here is free or already owned, and nothing was downloaded or bought.

Review images are in `assets-local/review/weapons/` (not committed):
- `<pack>-<type>.png` for each owned pack;
- `<pack>-all.png` for each web pack (store previews);
- `rarity-tiers-kaykit.png`;
- `lineup-kaykit-coverage.png`.

The review cards are in `scratchpad-cards/weapons.jsonl`.

The owned 3D sheets go through `gm-sprite-forge` `pixel_preview.py`: the pack camera, finish B, S and SE views, shown raw | pixel. Weapon-only packs were scaled by a reference height chosen so that a one-handed sword is about half a character's height:

| Pack | Reference height |
|---|---|
| KayKit | 3.54, the Knight's height |
| Kenney | 7.5 |
| Synty Viking | 3.6 |
| Synty Goblin | 2.2 |

## Recommendation: KayKit first

**One look:** every KayKit pack we own shares one style: chunky low-poly, one palette texture, CC0. Together they cover every weapon type, priest weapons included. They also survive the pixel pass better than the alternatives: their silhouettes stay readable at 20–30 px.

| Type | KayKit models we own | Pack |
|---|---|---|
| Axes | axe_A–D; axe_1handed and axe_2handed (+Large); Orc, Caveman, Frost Golem and Combat Mech axes; MM4 axe | [Fantasy Weapons Bits](https://kaylousberg.itch.io/fantasy-weapons-bits), [Adventurers](https://kaylousberg.itch.io/kaykit-adventurers), [Mystery Monthly 4](https://kaylousberg.itch.io/kaykit-series-4) / [5](https://kaylousberg.itch.io/kaykit-series-5) / [6](https://kaylousberg.itch.io/kaykit-series-6) |
| Hammers and maces | hammer_A–D; Skeleton_Mace (+Large); MM5 Hammer | Weapons Bits, [Skeletons](https://kaylousberg.itch.io/kaykit-skeletons), MM5 |
| Swords | sword_A–G (wood → steel → flame → ice); sword_1handed and sword_2handed; Black Knight, Vampire, Tiefling, Avian and Hoarder swords; Skeleton_Blade | Weapons Bits, Adventurers, MM5/6, Skeletons |
| Daggers | dagger_A–C; dagger; Skeleton_Dagger | Weapons Bits, Adventurers, Skeletons |
| Spears and polearms | spear_A, halberd, scythe; Caveman and PlantWarrior spears; Skeleton_Scythe | Weapons Bits, MM5/6, Skeletons |
| Bows and crossbows | bow_A–C (with and without string); bow; crossbow 1H and 2H; Skeleton_Crossbow; PlantWarrior bow; arrows, quiver | Weapons Bits, Adventurers, Skeletons, MM6 |
| Staffs and wands | staff_A–C; staff; wand_A and wand_B; wand; MagicalGirl wand; spellbook (open and closed); Skeleton_Staff | Weapons Bits, Adventurers, MM6, Skeletons |
| **Priest / holy** | **Cleric_Mace and Cleric_Shield (MM6); paladin_hammer, paladin_shield and paladin_book (MM4); Lorekeeper_Staff, a crook (MM6); staff_D, a gold sunburst (Weapons Bits); druid_staff (Adventurers)** | MM4, MM6, Weapons Bits, Adventurers |
| Shields | shield_A–D; 10 Adventurers shields (plain and colour); Cleric, Paladin, Black Knight, PlantWarrior and Barndoor shields; 4 Skeleton shields | all of the above |
| Fist weapons | fistweapon_A–C | Weapons Bits |

We own all of these through The Complete KayKit bundle ([itch, $150](https://kaylousberg.itch.io/kaykit-complete)). The Mystery Monthly series is $19.99 per series on its own.

**Detail range in KayKit:**
- **Plain:** wood sword_A, staff_A, the MM4 axe and hammer_C.
- **Steel:** axe_A/B, sword_B/E and the Adventurers set.
- **Ornate or magic:** sword_F (flame), sword_G (ice), staff_D (gold sunburst), spear_B (gold trident), dagger_C (green blade), the Frost Golem axe and paladin_hammer.

This range is enough for five tiers without tinting.

### Gaps in KayKit, and what fills them in a compatible style

1. **Censers, orbs and holy relics.** No pack has them, free or paid.
   - **Fix (variant path):** make them as `gm-asset-variants` clones from KayKit parts. A censer would be a [KayKit Dungeon Pack](https://kaylousberg.itch.io/kaykit-dungeon-pack) lantern on a chain. An orb would be a wand_B head scaled up on staff_A.
   - **Alternative:** the [Quaternius RPG Essentials](https://quaternius.com/packs/rpg.html) orb staffs (CC0, a close low-poly style).
2. **Holy sceptres and maces in depth.** KayKit has about 4 holy maces.
   - **Free:** [BinBun RPG Weapons](https://binbun3d.itch.io/rpg-weapons) (CC0) has 7 maces and 7 hammers, from plain to spiked. It uses a grey-steel palette texture that pixelates the same way.
   - **Paid:** [Pure Poly 900 Fantasy RPG Weapons](https://www.fab.com/listings/45616615-efef-46aa-80eb-bc7902e1aba8), $29.99 on sale (list $99.99). It has 39 sceptres, 53 maces and a "Holy" theme, plus 3+ upgrade steps per type. It is brighter than KayKit, but the pixel finish palette pulls it together.
3. **Ornate Legendary variety for axes and hammers.** KayKit has one or two per type.
   - **Free:** [Quaternius Ultimate RPG Items](https://quaternius.com/packs/ultimaterpg.html) (CC0) has 9 weapons in iron and 9 in gold, a ready-made gold step.
   - **Cheapest everywhere:** the tint-and-effect path shown in row 4 of the rarity sheet.
4. **Crossbows.** KayKit has only 3. [OGA Medieval Weapon Pack](https://opengameart.org/content/medieval-weapon-pack) (CC0) has 1 more. Pure Poly 900 has 33.

**Don't use these as primary sources:**
- [Synty](https://syntystore.com) packs: the owned [Viking Realm](https://syntystore.com/products/polygon-viking-realm) and [Goblin War Camp](https://syntystore.com/products/polygon-goblin-war-camp), and the paid ones below. They are thinner and more realistic, so KayKit pieces next to them look mismatched. The goblin bone clubs suit enemy drops.
- [Kenney Medieval Weapons](https://kenney.nl/upcoming): early access, plain only.
- [JustCreate Lite](https://justcreate3d.itch.io/low-poly-rpg-fantasy-weapons-lite): its licence forbids AI/ML use, which conflicts with our mock refs.

### 2D sprite option (already owned)

[SmallScaleInt Character Creator 2D Fantasy](https://smallscaleint.itch.io/character-creator-2d-fantasy) has 25 melee, 7 ranged, 3 magic, 7 shield and 2 offhand layers. They are drawn in the house style and already animated in every SSI action.
- The layers are grey and tinted at runtime (documented in its PDF), so rarity tinting is free.
- **Limitations:**
  - a 128 px frame, smaller than our HD heroes;
  - one priest-like staff (Melee21);
  - no censers;
  - we can't attach them to our 3D-rigged bodies. They fit only if a hero stays a 2D SSI layer stack.
- The type sorting on its sheets is guessed from idle frames.

## Free and open survey

| Pack | Licence | Weapons | Detail | Fit |
|---|---|---|---|---|
| [BinBun RPG Weapons](https://binbun3d.itch.io/rpg-weapons) | CC0, free (Pro $5.99+) | 70 free: 7 each of short sword, long sword, sabre, spear, dagger, mace, axe, hammer (+tools). Pro adds clubs, staffs, scythes, bows, shields | 7 variants per type, plain → spiked | Best free complement to KayKit |
| [Quaternius Modular Weapons](https://quaternius.com/packs/medievalweapons.html) | CC0 | 24: ~8 swords/daggers, 2 axes, 2 hammers, spear, scythe, 4 bows, 5 shields | Steel + gold/gem | Close to KayKit |
| [Quaternius Ultimate RPG Items](https://quaternius.com/packs/ultimaterpg.html) | CC0 | 9 weapons × iron/gold | 2 tiers | Gold step for Rare+ |
| [Quaternius RPG Essentials](https://quaternius.com/packs/rpg.html) | CC0 | 2 swords, shield, 3 staffs (gem, orb, crook) | Plain | Priest orb/crook |
| [Quaternius Fantasy Props MegaKit](https://quaternius.itch.io/fantasy-props-megakit) | CC0 (Pro $9.99+) | few weapons (~3 swords, ~4 axes, ~4 hammers) | Plain | Shop racks |
| [CardinalZebra LowPoly Fantasy Weapons](https://cardinalzebra.itch.io/low-poly-fantasy-weapon-pack) | CC0, pay what you want | 21 incl. spiked mace, wand, tome | Plain | OK |
| [VertexFrog Stylised Fantasy Weapons](https://vertexfrog.itch.io/free-stylised-fantasy-weapons) | free commercial ([OGA copy](https://opengameart.org/content/stylised-fantasy-weapons) CC-BY 3.0) | 8 incl. mace, staff | Hand-painted | Too few |
| [Pure Poly Free Fantasy RPG Weapons](https://www.fab.com/listings/c4243deb-b540-4e85-b34a-961c8543ae78) ([Unity](https://assetstore.unity.com/packages/3d/props/weapons/free-low-poly-fantasy-rpg-weapons-248405)) | Fab Standard | 26, incl. a holy wand and a sceptre | One per theme | Taster for the 900 pack |
| [OGA Medieval Weapon Pack (System G6)](https://opengameart.org/content/medieval-weapon-pack) | CC0 | 14 incl. mace, crossbow, gem staff, grimoire | Dark, muted | Good |
| [OGA 19 Low-Poly Fantasy Weapons](https://opengameart.org/node/32331) | CC0 | 19 incl. mace, halberd, glaive, bardiche | Untextured | Polearm shapes |
| [OGA Staffs Pack (Zsky)](https://opengameart.org/content/staffs-pack) | CC-BY 4.0 | 5 staffs incl. a glowing orb | Plain → glow | Priest fill-in |
| [Stylized Fantasy Armory](https://assetstore.unity.com/packages/3d/environments/fantasy/stylized-fantasy-armory-low-poly-3d-art-249203) | Unity EULA, free | ~90 weapons and shields (unverified) | unverified | Unverified |
| [JustCreate Lite](https://justcreate3d.itch.io/low-poly-rpg-fantasy-weapons-lite) | custom, **no AI/ML** | 7 | Plain | Licence conflict |

Other sources checked:
- **Kenney:** nothing newer than Medieval Weapons, which is still on [kenney.nl/upcoming](https://kenney.nl/upcoming).
- **[Poly Pizza](https://poly.pizza/bundle/Ultimate-RPG-Items-Bundle-h8mhlZ0dG8):** only mirrors the Quaternius items.
- **Sketchfab:** no CC0 fantasy weapon set turned up.

## Paid: top options

| Pack | Price | Why |
|---|---|---|
| [Pure Poly 900 Fantasy RPG Weapons](https://www.fab.com/listings/45616615-efef-46aa-80eb-bc7902e1aba8) | $29.99 on sale (list $99.99) | 904 weapons in 11 themes, incl. Holy: 53 maces, 39 sceptres, 37 wands, 33 crossbows, 3+ upgrade steps per type. The only true tiered mega-pack, and the best fill for priest gear. |
| [Synty POLYGON Dark Fantasy](https://syntystore.com/products/polygon-dark-fantasy) ([video](https://www.youtube.com/watch?v=kDf3vU62mDE)) | $100 | The best gritty tone: cross, maces, lantern mace, a priest character. Synty proportions, not KayKit. |
| [Synty POLYGON Dungeon Pack](https://syntystore.com/products/polygon-dungeon-pack) ([video](https://www.youtube.com/watch?v=ACBH9wTBQbU)) | $75 | 73 weapons × 4 colour variants, with crystal and ornate lines, so the tiers are built in. |
| [Synty POLYGON Fantasy Kingdom](https://syntystore.com/products/polygon-fantasy-kingdom) ([video](https://www.youtube.com/watch?v=Y3127q0GBRs)) | $105 | 111 weapons, 9+ sceptres, 72 modular parts. |
| [Synty POLYGON Dungeon Realms](https://syntystore.com/products/polygon-dungeon-realms) ([video](https://www.youtube.com/watch?v=RpH851L0SCU)) | $100 | 81 weapons, from plain to gold. |

If Kevin buys one, my pick is Pure Poly 900 for $29.99, for the priest sceptres and maces and the per-type upgrade steps. Buying needs his OK.

## Rarity mapping (5 tiers, built from KayKit)

The mock is `assets-local/review/weapons/rarity-tiers-kaykit.png`: three model lines, plus one row showing a single model tinted per tier.

| Tier | Colour (name, frame, beam) | Sources | Model choice | World/hand effect |
|---|---|---|---|---|
| **Common** | white `#FFFFFF` | vendor, crafting, early quests; no stats | plain wood or iron, the simplest silhouette | none |
| **Uncommon** | green `#1EFF00` | quest, world and instance drops, crafted; 1–2 stats | steel, slightly larger, one detail (binding, flange) | none in hand. A green drop beam and name. |
| **Rare** | blue `#0070DD` | dungeon and boss, strong crafted, quest chains; up to 4 stats | two-handed or decorated, a second material (bronze trim) | **glint**: a 1 px rim and a sparkle every few seconds |
| **Epic** | purple `#A335EE` | raid, high dungeon, high crafting; strong stats or special effects | gem or rune head, unusual shape | **aura**: a soft tier-colour outline glow that pulses slowly |
| **Legendary** | orange `#FF8000` | iconic, lore-heavy items from major chains or rare drops | a unique model (gold, elemental, holy) | **aura + particles**: orange glow plus embers or holy motes. A light on the hero. A unique swing trail. |

The colours are the familiar MMO set, chosen so players read them at once.

**Rules:**
- **The frame and name carry the tier.** Use the item-frame border, the name colour, the drop beam and the minimap pip.
- **The world effect stays small at pixel scale.** At 20–30 px, a rim or aura reads better than texture detail.
- **The model or material carries the rest:** a different KayKit model per tier where one exists. Otherwise, tint the same model per tier. Row 4 shows that version: the Greataxe in steel-blue, violet or gold, with the same effect stack.
- **Effects are done after the pixel finish, in 2D.** They are a palette-swap tint plus outline, glow and particle layers in the engine. They are not baked into the 3D render, so one render serves all tiers.

### Example lines (all owned KayKit)

| Tier | Warrior axe | Priest staff | Priest mace |
|---|---|---|---|
| Common | Woodsman's Hatchet: MM4 `axe` | Pilgrim's Staff: Weapons Bits `staff_A` | Studded Cudgel: Weapons Bits `hammer_C` |
| Uncommon | Iron Bearded Axe: Weapons Bits `axe_A` | Grove Blessing: Adventurers `druid_staff` | Flanged Mace: Skeletons `Skeleton_Mace` |
| Rare | Reaver's Greataxe: Adventurers `axe_2handed` | Shepherd's Crook: MM6 `Lorekeeper_Staff` | Cleric's Mace: MM6 `Cleric_Mace` |
| Epic | Duskforged Cleaver: Weapons Bits `axe_D` | Vigil of the Verdant: Weapons Bits `staff_C` | Penitent Star: Weapons Bits `hammer_B` |
| Legendary | Rimeheart: MM5 `FrostGolem_Axe` | Dawnbringer: Weapons Bits `staff_D` | Lightwarden: MM4 `paladin_hammer` |

The item names are placeholders for Kevin to rename.

## Method and caveats

- The owned inventory comes from the model files in `assets-local/packs/*`, rendered with the forge pixel preview. Synty FBX files were re-exported to GLB with their atlas texture first, because the preview does not texture FBX.
- The web counts come from store pages and previews, and are marked "~" or unverified where the page gave no count. Web packs get one sheet each from store previews: a pack can't be split by type without downloading it, and downloading waits for Kevin's pick.
- Pack scale is normalised by a reference height (see the top), not by each pack's own character. KayKit's Knight is 3.54 units tall.
