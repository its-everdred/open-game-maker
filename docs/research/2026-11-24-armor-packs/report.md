# Armor and robe packs for the 4 hero classes (2026-11-24)

Kevin, ~03:25Z: "find armor, robes packs for all 4 classes … include pack armor comparison images". At ~04:20Z he added: "kaykit looks best so far".

**Classes:** W = Warrior, Wiz = Wizard, R = Ranger, P = Priest/healer.

**How the 3D packs were shown:** sheets show the original 3D render ("raw") beside the pixel preview tool's version, at 43 px in an idle pose, facing S and SE. Weapons are covered in `docs/research/2026-11-24-weapon-packs`.

## Recommendation

**Use KayKit for the look, and add a modular filler for gear depth.**

**KayKit packs (all owned, all CC0):**
- [Adventurers](https://kaylousberg.itch.io/kaykit-adventurers), Extra tier.
- Mystery Monthly [Series 4](https://kaylousberg.itch.io/kaykit-series-4), [Series 5](https://kaylousberg.itch.io/kaykit-series-5) and [Series 6](https://kaylousberg.itch.io/kaykit-series-6).

**Why it works:**
- Every class has outfits, including a real priest (the Series 6 Cleric) and a Paladin.
- Every character is on KayKit's Rig_Medium skeleton, so one animation set drives them all.
- Each Adventurers class ships 4 colour versions (a base texture plus alternatives A, B and C). That gives rarity colourways for free.

**KayKit gaps:**
- Outfits are whole characters. There are no separate helm, chest or legs slots.
- There are no male/female pairs per class. Several characters are female (Witch, Magical Girl, Cleric, Mage).
- Proportions are chibi.
- KayKit sells no further character packs. We own every current one (checked [kaylousberg.itch.io](https://kaylousberg.itch.io)).

**Filler for modular gear, both sexes:** the [Polytope Low Poly Modular Armors bundle](https://assetstore.unity.com/packages/3d/characters/humanoids/lowpoly-modular-armors-bundle-medieval-fantasy-series-230383), $129.99 ([video](https://www.youtube.com/watch?v=xkmMBgdWZws)).
- It is the only pack found with all 4 classes, male and female, three quality tiers (A/B/C) and a Mixamo-ready rig.
- Its flat-colour low-poly look is the closest to KayKit among the modular packs.
- Caveats: its gear fits Polytope's own base bodies, not ours; its proportions are realistic, not chibi; and whether the Unity Asset Store licence allows use outside Unity is unverified.
- Test it first with the free [Polytope Free](https://assetstore.unity.com/packages/3d/characters/lowpoly-modular-armors-free-medieval-fantasy-series-199890), which uses the same rig.

**2D fallback:** the owned [SSI Character Creator Fantasy](https://smallscaleint.itch.io/character-creator-2d-fantasy) layers. They match the house style and are modular per slot. But there is one body and no female, only 2 real robes, and no priest art.

## What we own

| Pack | W | Wiz | R | P | Slots | M/F | Format | Detail range |
|---|---|---|---|---|---|---|---|---|
| [SSI Character Creator Fantasy](https://smallscaleint.itch.io/character-creator-2d-fantasy) | 2 plates, mail, leather, horned and visored helms | 2 robes, tabard robe, shaman rags, wide hat, hood | jackets, belted coat, hood, quiver | recolour only | Head 23, Chest 19, Legs 9, Shoes 5, Hands 4, Belt 2, Bag 7; no shoulder or cloak slot | one human body (the other two are a skeleton and a spectral body); **no female** | 2D grey layers tinted at runtime, 128 px cells, 8 directions | plain shirt → heavy plate |
| [KayKit Adventurers](https://kaylousberg.itch.io/kaykit-adventurers) | Knight, Barbarian, Barbarian Large | Mage | Ranger, Rogue, Rogue Hooded | Druid | whole outfits | no pairs | glTF/FBX, Rig_Medium, 4 textures per class | 1 outfit × 4 colourways |
| KayKit Mystery Monthly [S4](https://kaylousberg.itch.io/kaykit-series-4) / [S5](https://kaylousberg.itch.io/kaykit-series-5) / [S6](https://kaylousberg.itch.io/kaykit-series-6) | Paladin (with/without helmet), Black Knight, Avian Swordsman, Plant Warrior | Witch, Lorekeeper, Tiefling, Magical Girl, Vampire | Marksman, Ninja, Survivalist | **Cleric**, Paladin | whole outfits | mixed | Rig_Medium, CC0 | cloth (Farmers, Protagonists) → ornate |
| [Synty POLYGON Viking Realm](https://syntystore.com/products/polygon-viking-realm) | 4 warriors (2 F, 2 M), 2 leaders, 12 helmets and crowns, 2 capes, furs | – | – | Leader F (long dress) | whole outfits plus attachments | **M+F** | FBX, Synty humanoid rig (previews are in T-pose) | peasant → leader |
| Synty Sidekick Goblin Fighters | goblin parts only | – | – | – | 36 slots | goblin bodies | locked to Synty's Unity tool | not usable as is |

## Free and open sources

| Source | Classes | M/F | Rig | Licence |
|---|---|---|---|---|
| [Quaternius Modular Character Outfits Fantasy](https://quaternius.itch.io/modular-character-outfits-fantasy) | free tier: R + peasant; $15 Source tier: W, R, Wiz, noble (no P); 62 parts | yes, on [Universal Base Characters](https://quaternius.itch.io/universal-base-characters) | humanoid, retargetable | CC0 |
| [Polytope Free](https://assetstore.unity.com/packages/3d/characters/lowpoly-modular-armors-free-medieval-fantasy-series-199890) | 6 sets, mostly W/R | yes | Mixamo-ready | Unity EULA |
| [Synty Sidekick Starter](https://syntystore.com/products/sidekick-modular-characters-starter-pack) | knight parts | yes (blend shapes) | Unity Humanoid | Synty |
| [Character Constructor](https://assetstore.unity.com/packages/slug/303401) | plate/cape prototype, 80+ parts | yes | rigged | Unity EULA |
| [OpenGameArt Modular RPG Characters](https://opengameart.org/content/modular-rpg-characters) | mixed; a commenter says the armour isn't skinned | yes | rigged | CC0 (unverified) |
| [MPFB2](https://extensions.blender.org/add-ons/mpfb/) | no armour or robe library | yes | Mixamo rig | free |

## Paid: top 4

| # | Pack | Price | W / Wiz / R / P | Slots | M/F | Rig | Tiers | Licence |
|---|---|---|---|---|---|---|---|---|
| 1 | [Polytope bundle](https://assetstore.unity.com/packages/3d/characters/humanoids/lowpoly-modular-armors-bundle-medieval-fantasy-series-230383) = [Base](https://assetstore.unity.com/packages/3d/characters/humanoids/lowpoly-modular-armors-medieval-fantasy-series-229963) + [Ex01](https://assetstore.unity.com/packages/3d/characters/humanoids/lowpoly-medieval-modular-armors-expansion-pack-01-230037) + [Ex02](https://assetstore.unity.com/packages/3d/characters/humanoids/lowpoly-modular-armors-expansion-pack-02-medieval-fantasy-series-204884) | $129.99 ($64.99 each) | all 4 (templar tabards, white/gold vestments) | helmet, cape, body, gauntlets, legs, boots | yes | Mixamo-ready | cloth/leather/plate × A/B/C | Unity EULA |
| 2 | [Synty Modular Fantasy Hero](https://syntystore.com/products/polygon-modular-fantasy-hero-characters) ([video](https://www.youtube.com/watch?v=vM4fSXvXHfY)) | $75 (sale, list $149.99) | W ✔, Wiz partial, R ✔, P weak | 720 parts, including shoulder/elbow/knee pads and capes | every part | Synty humanoid | cloth → plate | Synty |
| 3 | Sidekick [Fantasy Knights](https://syntystore.com/products/fantasy-knights-sidekick-modular-character-pack) + [Fantasy Sorcerers](https://syntystore.com/products/fantasy-sorcerers-sidekick-modular-characters) | $100 + $139.99 | W, Wiz only | very granular | blend shapes | locked to Synty's tool | ornate | Synty |
| 4 | [Ironic RPG Human Male](https://assetstore.unity.com/packages/slug/51227) | $90 | all 4 (Cleric, Sorcerer, Ranger, Knight) | armour, robes, cloak | **male only** | unverified | cloth → plate, realistic | Unity EULA |

**Runners-up:**
- [Blink Stylized RPG Armor Sets Bundle](https://assetstore.unity.com/packages/3d/characters/humanoids/fantasy/stylized-rpg-armor-sets-bundle-227641): $149.99 plus base bodies; W/R only.
- [N-Hance Stylized Fantasy Outfits #2](https://assetstore.unity.com/packages/3d/characters/stylized-fantasy-outfits-pack-2-252142): $129.99; W/R only.
- [Dungeon Mason RPG Modular Hero Bundle Polyart](https://assetstore.unity.com/packages/3d/characters/humanoids/fantasy/rpg-modular-hero-bundle-polyart-321290): $60; chibi.
- [Customizable Characters – Medieval Fantasy HD](https://marketplace.unity.com/packages/3d/characters/humanoids/fantasy/customizable-characters-medieval-fantasy-HD-175251): $24.99; M+F, Mixamo, older art.

[SmallScaleInt](https://smallscaleint.itch.io) sells no armour, robe or priest expansion.

## Rarity sketch (Common → Legendary)

| Tier | Material | W | Wiz | R | P | KayKit source |
|---|---|---|---|---|---|---|
| Common | cloth | padded tunic | plain robe | cloth shirt | novice robe | Farmers, Protagonists; base texture |
| Uncommon | leather | jerkin | trimmed robe | leather | trimmed vestment | alt texture A |
| Rare | mail | mail + pauldron | hooded mantle | hooded cloak + bracers | tabard over mail | alt texture B; Rogue Hooded |
| Epic | plate | plate | ornate robe + hat | studded leather + cloak | battle cleric | alt texture C; Knight, Paladin |
| Legendary | ornate | gilded plate | arcane regalia | ranger lord | holy plate | Black Knight, Paladin with Helmet, Cleric (+ glow effect) |

With modular gear (Polytope or SSI layers), each slot moves up a tier on its own. With KayKit, a tier means swapping the whole outfit or its texture.

## Not verified

- Whether the Unity Asset Store licence allows use in our web engine.
- Whether Sidekick parts export as plain FBX.
- The Ironic pack's rig, and whether a female version exists.
- Stock for Sidekick Knights and Sorcerers.
- Whether Synty POLYGON Knights and Dungeon are modular.

## Sheets

All are in `assets-local/review/armor/`:
- `compare-by-class.png`
- `kaykit-adventurers-{warrior,wizard,ranger,priest}.png`
- `kaykit-tiers-{warrior,wizard,ranger,priest}.png`
- `kaykit-mystery-{warrior,wizard,ranger,priest,cloth}.png`
- `ssi-character-creator-fantasy-{warrior,wizard,ranger,priest,heads,chest,legs,boots,gloves,belts-back}.png`
- `synty-viking-realm-{warrior,leaders,peasant,helms,cloaks}.png`
- `polytope-modular-armors-{base,warrior,wizard-priest}.png`
- `synty-fantasy-hero.png`, `synty-sidekick-{knights,sorcerers}.png`, `ironic-rpg-human-male.png`, `quaternius-outfits-fantasy.png`

The paid and free packs we don't own are shown from store preview images only; nothing was downloaded or bought.

