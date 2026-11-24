# Humble bundles for Dusk Helm: can we use them? (2026-11-24)

Kevin asked (~10:00Z) whether three Humble bundles work in our three.js / Blender pixel pipeline, and which is best.
Sources: each Humble page's embedded data (tiers, items, MSRP), Fab's public listing API (`fab.com/i/listings/<uid>`:
formats, licence group, NoAI flag), Cosmos by Leartes' public API, FAQ and licence. Nothing was bought, downloaded or logged into.

## Recommendation

**Buy Hivemind's Modular Worldbuilder at $25, and only if we want 3D dark-fantasy architecture** (castles, dungeons,
graveyards, villages) for HD-2D/three.js scenes or building renders. Otherwise **buy none**. None of the three bundles adds
what we're actually short of: chunky KayKit-style weapons, modular armor for our base bodies, or characters.

- **Hivemind** is the only bundle that is mostly medieval or dark fantasy. Its $25 tier includes Unity Asset Store keys for
  about 27 of the packs. A .unitypackage is a tar.gz of FBX and PNG files, which we can open in Blender without Unity or
  Unreal. Unity says Asset Store assets may be used in other engines.
- **Leartes (UltimateCyber)** is usable (Cosmos ships FBX/OBJ, PNG and WAV/MP3), but most of it is realistic cyber or
  modern. Its licence also bans using the content as "reference material for AI/ML systems". Second choice ($30) only for the
  Medieval Armor & Body Impact SFX and a few dark environments. **Ends Nov 26.**
- **Premium Assets Unreal**: skip. Every item ships as Unreal Engine format only (.uasset). The effects are Niagara systems,
  which only run in Unreal. The content is mostly sci-fi or modern.

| Bundle | Tiers | Ends | Usable outside Unreal? | Fit to Dusk Helm | Value to us |
|---|---|---|---|---|---|
| [Premium Assets Unreal Game Dev Collection](https://www.humblebundle.com/software/premium-assets-unreal-game-dev-collection-software) | $5 (2) / $15 (7) / $25 (37) | Dec 3 | Licence yes; files no (UE only, needs an Unreal install to export FBX) | Poor: sci-fi, modern, realistic | Skip |
| [Modular Worldbuilder (Hivemind)](https://www.humblebundle.com/software/modular-worldbuilder-bundle-hivemind-software) | $5 (1) / $15 (3) / $25 (62 keys, ~35 packs) | Dec 9 | Yes at $25, through the Unity keys (FBX + PNG) | Best: medieval and dark fantasy, mostly semi-realistic | $25 if we want 3D buildings |
| [UltimateCyber / Leartes All-in-One](https://www.humblebundle.com/software/ultimatecyber-november-game-dev-bundle-software) | $5 (6) / $15 (13) / $30 (75) | Nov 26 | Yes: Cosmos ships FBX/OBJ, PNG, WAV/MP3; no engine limit | Mostly poor (cyber, modern); 8–9 dark-fantasy packs | Maybe, $30 |

## Licences

- **Fab Standard License** ([EULA](https://www.fab.com/eula), [licences and pricing](https://dev.epicgames.com/documentation/en-us/fab/licenses-and-pricing-in-fab)):
  "usage is not limited to Unreal Engine". The Humble keys are the **Professional** tier, which grants the same rights as
  Personal. Every bundle item I matched on Fab is in the `standard` licence group; I found no UE-Only flag on any of them.
  Two items in Kevin's tiers are unverified: Casino (its detail page returned 403 to our client) and Ancient Desert Ruins
  (looked up by hand).
- **The format is the catch, not the licence.** Fab lists nearly every item as `unreal-engine` only, meaning
  .uasset/.uproject files. To get FBX we would have to install Unreal (Linux build, about 100 GB) and export the meshes by
  hand. Exceptions: Post-Soviet World (also Unity), Hivemind Stylized Nature, Destroyed Buildings and Viking Village (also
  Unity), Leartes Minotaur Statue (Blender and GLB), Underwater Art Deco Hotel (also GLB).
- **Fab NoAI flag.** Most of these listings set `isAiForbidden: true`. Fab's terms forbid using NoAI content in datasets for
  generative AI, in building generative AI, or "as inputs" to it. The EULA (§16(l)) narrows that to "training inputs"
  ([forum thread](https://forums.unrealengine.com/t/noai-content-inputs-or-training-inputs/2838630)). Our blender pixel
  finish is fine. Attaching these assets to image-generation mocks (the creative lane) is not safe: treat them as no-mock.
- **Unity Asset Store EULA**: Unity's support article
  ([Can I use assets from the Asset Store with other engines?](https://support.unity.com/hc/en-us/articles/34387186019988-Can-I-use-assets-from-the-Asset-Store-with-other-engines))
  says yes, under the EULA, as long as the assets aren't redistributed as standalone files. See also the [EULA FAQ](https://assetstore.unity.com/browse/eula-faq).
- **Cosmos by Leartes** ([Digital Asset Licensing Contract](https://cosmos.leartesstudios.com/legal/digital-asset-licensing-contract)):
  §2.1 covers digital media, game development and interactive content, with no engine limit. §2.2 forbids use "as training
  data or reference material for AI/ML systems", which rules out creative-lane mocks. The Individual tier covers revenue
  up to $100k. The [FAQ](https://cosmos.leartesstudios.com/frequently-asked-questions) lists .obj/.fbx meshes, .png/.jpeg
  textures and .mp3/.wav sound; VFX come as .unitypackage or .uasset. Product records list platforms
  `{ue: true, unity: true}` (checked: Demonic Village and Fantasy Gothic Castle).
- **Humble**: Premium keys redeem on Fab; Hivemind keys on Fab and the Unity Asset Store; Leartes content on
  [Cosmos](https://cosmos.leartesstudios.com/redeem). Each bundle has a $5 minimum.

## Fit to Dusk Helm (pixel finish at about 43 px)

Contact sheets of the store previews (no free models were available without buying):
`assets-local/review/humble-eval/premium-unreal.png`, `hivemind.png`, `leartes.png`.

- **All three are "AAA realistic" environment kits** built for Lumen and Nanite: dense meshes, 4K PBR textures, a lot of
  their mood from lighting. At pack scale, props and furniture lose their detail; large silhouettes such as walls, towers,
  arches and gravestones survive. Expect to rebuild materials (flat colours) before the pixel finish, as we do for anything
  that isn't KayKit.
- **Hivemind**:
  - Strong fits: Ravenhold, Duskbane, Castle Forge, Dungeon Forge, Dark Halls, Graveyard, Crownfall, Haunted Mansion and
    Haunted House, Viking Village, Medieval Town/Docks, Sherwood.
  - Stylized and closer to the KayKit palette: Glimvale/Stylized Village, Wildwood, Everwild, Windvale, Stylized Nature.
  - Also: Ultimate Animal Bundle (wolves, deer: possible ARPG critters; Fab key only, so Unreal format) and Ultimate Horse
    System (Fab only).
- **Leartes**:
  - Dark-fantasy picks: Demonic Village, Merlin's Cave, Dwarven Dungeon, Fantasy Gothic Castle, Medieval Tavern, Grand
    Ossuary, Gothic Cathedral, Sorcerer's Hut, Frozen Harbor Fortress. Stylized picks: StylArts Lost Civilization, Ancient
    Ruins, Eastern Province.
  - Audio: **SFX Medieval Armor & Body Impact** fits combat directly.
  - The rest (cars, guns, Neo Tokyo, favela, office, police) doesn't fit.
- **Premium Unreal**: The Bone Temple (bones and occult props) and Riverside European Village are the only fits. The
  Niagara effects (slashes, projectiles, loot drops) can't leave Unreal; the most we could take is their flipbook textures.

## What each adds compared with what we own

We own KayKit, SmallScaleInt (SSI, the house isometric style), Kenney, Quaternius and Synty Viking/Goblin.

| Gap | Hivemind | Leartes | Premium Unreal |
|---|---|---|---|
| Weapons / items (KayKit taste) | – | modern and Western guns only | – |
| Modular armor for our base bodies | – | – | – |
| Characters | – | police and mafia NPCs (no fit) | – |
| Dark-fantasy environments in 3D | **many** (castles, dungeons, graveyards, villages) | several, realistic | Bone Temple |
| Creatures | animals (UE format) | – | – |
| Effects | Unity realistic gun, blood and fire effects (Unity particle systems) | UE smoke, explosion, warzone | Niagara only |
| Audio | – | **armor and body impacts**, footsteps, movement | – |

SSI already covers Dusk Helm's isometric environments as pixel sprites. So Hivemind adds a 3D source for HD-2D or real-time
three.js scenes and building renders. It doesn't fill a gap in today's sprite pipeline.

## Open checks before or after buying

- Confirm that a Hivemind Unity package holds FBX meshes and PNG textures (expected; not verified without a key).
- Run the pixel_preview lineup on 3–5 Hivemind meshes (a wall segment, a tower, a gravestone, a well) before committing
  them to the style.
- Leartes items with no exact Fab match (SFX packs, VFX Smoke, Warzone VFX, Modular Stylized Village) are delivered on
  Cosmos; their formats come from the Cosmos FAQ.

## Items per bundle

Formats and licence come from each item's Fab listing (Unity rows from the Humble key type). "NoAI" is Fab's `isAiForbidden`.
Leartes content is delivered through Cosmos (UE plus Unity/FBX), whatever Fab lists.

### Premium Assets Unreal Game Dev Collection

| Tier | Item | MSRP | Store page | Formats (store) | Licence | NoAI |
|---|---|---|---|---|---|---|
| $5 | Retro Sci-Fi Research Cabin Environment | $29.99 | [Fab](https://www.fab.com/listings/da5cd6e1-9cd7-4433-8b28-32bf26925564) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $5 | Stylized Slashes Vol.2 - Niagara | $19.99 | [Fab](https://www.fab.com/listings/9fe6bbb4-8f49-4a0a-871e-03005c406449) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $15 | Volcano Land Environment | $49.99 | [Fab](https://www.fab.com/listings/16d3e88d-6e0c-44e1-9d5d-b421d3ff1ca1) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $15 | Motel Furniture Props Pack | $19.99 | [Fab](https://www.fab.com/listings/033d998f-5595-4f41-b078-809db0c496a8) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $15 | Prison | $14.99 | [Fab](https://www.fab.com/listings/d30a464d-9458-4557-98ae-e35135bf9f92) | unreal-engine | Fab Standard (Personal/Professional) | no |
| $15 | Rail-Mounted Gantry Crane | $29.99 | [Fab](https://www.fab.com/listings/13e40574-1253-4db8-8393-77b6dcb646cb) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $15 | Stylized Japanese Street | $19.99 | [Fab](https://www.fab.com/listings/a462bada-e0ea-4b4c-bdd4-9e3429f4f5d4) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Riverside European Village Environment | $79.99 | [Fab](https://www.fab.com/listings/bc721ab3-c974-4ed4-91c8-e3011bd0295d) | unreal-engine | Fab Standard (Personal/Professional) | no |
| $25 | Sci-Fi Polar Station Environment | $29.99 | [Fab](https://www.fab.com/listings/77822f2c-4230-4e52-838e-654d67cfa2ea) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Barcelona Square Environment | $79.99 | [Fab](https://www.fab.com/listings/cbe6f355-7eb3-4b6b-8b99-f45e9817a11f) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Container Disctrict Environment | $99.99 | [Fab](https://www.fab.com/listings/b7f1dd54-068d-40cb-abc8-058b65a0cd6e) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Ancient Desert Ruins Environment | $79.99 | [Fab](https://www.fab.com/listings/18f750c4-f694-493c-bdb0-f045fddf917e) | unreal-engine | Fab Standard (Personal/Professional) | ? |
| $25 | Alien Planets Environment | $99.99 | [Fab](https://www.fab.com/listings/7efa2ef7-5938-4313-b81e-566a498871b5) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Orbital Base Environment | $79.99 | [Fab](https://www.fab.com/listings/a0b286ca-723c-4cd3-997c-9f05d195b0b0) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Sci-fi Props Pack Vol.1 | $19.99 | [Fab](https://www.fab.com/listings/406db9b3-9220-42b5-a147-e96eff010f89) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Ethnic Furniture Props Pack | $24.99 | [Fab](https://www.fab.com/listings/824be247-b284-47c1-99d6-2254f96f9537) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Post-Soviet World | $54.99 | [Fab](https://www.fab.com/listings/eade46b4-ba59-4230-955f-3704809bd55b) | unreal-engine, unity | Fab Standard (Personal/Professional) | no |
| $25 | Post-Soviet World 2.0 | $89.99 | [Fab](https://www.fab.com/listings/bf4cb3bb-21e3-497a-84f1-1197ff046833) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | The Bone Temple | $37.99 | [Fab](https://www.fab.com/listings/6e0f1619-2a1f-4184-b61a-4b35985dc8d7) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Space Colony & Sci-Fi City | $49.99 | [Fab](https://www.fab.com/listings/c3c4d8c0-e43f-4a31-a0df-8977bbbcef4d) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Post-Apocalyptic Wasteland | $21.99 | [Fab](https://www.fab.com/listings/69657a63-e407-49fe-b50d-a50c20e3233f) | unreal-engine | Fab Standard (Personal/Professional) | no |
| $25 | Concrete Shelter & Bunker Constructor | $59.99 | [Fab](https://www.fab.com/listings/b0243d5f-ab5c-48a0-87ef-164a47123a71) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Warehouse Big Pack | $54.99 | [Fab](https://www.fab.com/listings/ff6df3b8-b366-4dcc-9f55-8b75a6ad3ca2) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Residential Buildings | $23.99 | [Fab](https://www.fab.com/listings/95f3f188-47fe-4564-8797-467b2510e538) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Planes in the Sky | $11.99 | [Fab](https://www.fab.com/listings/9b395db6-a7f5-4632-afc7-15f71b09022a) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Water Slide System | $38.99 | [Fab](https://www.fab.com/listings/bee7acf2-30be-4567-a994-1163f7992489) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Industrial Pipe Rack | $9.99 | [Fab](https://www.fab.com/listings/763f8229-61bf-4f43-a71e-6f5366515b37) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Casino | $29.99 | [Fab](https://www.fab.com/listings/8915ff56-8d40-4a1f-ab35-801a4e7acf30) | unreal-engine (search) | Fab Standard (detail API 403) | ? |
| $25 | Military Vehicles Pack | $99.99 | [Fab](https://www.fab.com/listings/e02f46b1-b1dc-4546-8fc7-16e13f1951f7) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Magic Projectiles Vol.5 - Niagara | $24.99 | [Fab](https://www.fab.com/listings/94e49a29-6691-4443-b3a5-44941cbc103a) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Stylized Shields Vol.1 - Niagara | $19.99 | [Fab](https://www.fab.com/listings/47bb5468-aef0-4613-b523-5af3a6e26b8f) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Toon Explosions Vol.2 - Niagara | $24.99 | [Fab](https://www.fab.com/listings/e6b0a7e9-684c-4e85-93c4-623a84b78df5) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Toon Explosions Vol.1 - Niagara | $24.99 | [Fab](https://www.fab.com/listings/f1810254-f748-4c8d-9072-603d2787ada6) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Magic Projectiles Vol.4 - Niagara | $24.99 | [Fab](https://www.fab.com/listings/76abf26d-d881-4e8b-a5bf-84ca111562bc) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Loot Drops Vol.2 - Niagara | $14.99 | [Fab](https://www.fab.com/listings/c9422fec-19c1-42bf-be3e-9f375ba4cb71) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Steampunk Zeppelin Station | $69.99 | [Fab](https://www.fab.com/listings/066cd62d-9575-4ad4-bbe1-c31f67f7cd8b) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Steampunk Modular Cafe Environment | $39.99 | [Fab](https://www.fab.com/listings/c03c1759-7985-41f9-8c56-8b06699f0d38) | unreal-engine | Fab Standard (Personal/Professional) | yes |

### Modular Worldbuilder (Hivemind)

Unity-key rows: the Humble page links the Unity store page where it gives one.

| Tier | Item | MSRP | Store page | Formats (store) | Licence | NoAI |
|---|---|---|---|---|---|---|
| $5 | Medieval Furniture Props (FAB Professional License Key) | $59.99 | [Fab](https://www.fab.com/listings/aa584fda-82a3-4f6f-8675-e2f8fab14daf) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $15 | Ultimate Animal Bundle (FAB Professional License Key) | $59.99 | [Fab](https://www.fab.com/listings/5c4ba704-9daa-45ec-98ae-3c5648ab1365) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $15 | Modular Wooden Buildings (FAB Professional License Key) | $99.99 | [Fab](https://www.fab.com/listings/da4eef5a-f6b1-4ae3-8258-34fc51915e27) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Ultimate Horse System (FAB Professional License Key) | $179.99 | [Fab](https://www.fab.com/listings/0f1d9f24-9f5a-42dd-8934-5d6dbf1bc002) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Everwild: Stylized Nature Megapack (FAB Professional License Key) | $89.99 | [Fab](https://www.fab.com/listings/2ae370c9-0175-4894-b02b-1ecff49c25e6) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Ravenhill (FAB Professional License Key) | $129.99 | [Fab](https://www.fab.com/listings/5f94d87a-382d-46db-ba1c-5eb9eeb10279) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Castle Forge: Modular Medieval Castle (FAB Professional License Key) | $159.99 | [Fab](https://www.fab.com/listings/8b55ff8e-9d1c-43d8-9078-6aa03a4ffcd7) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Rivervale (FAB Professional License Key) | $129.99 | [Fab](https://www.fab.com/listings/6b7ba763-5b2e-4047-acdb-5a77da286459) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Ravenhold: Modular Dark Fantasy Megapack (FAB Professional License Key) | $159.99 | [Fab](https://www.fab.com/listings/3bfee149-0741-4892-ba2c-b7a245e45de7) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Windvale (FAB Professional License Key) | $79.99 | [Fab](https://www.fab.com/listings/8124854a-0018-4f3a-8cab-bb2f1fb663c6) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Crownfall: Modular Cathedral Megapack (FAB Professional License Key) | $119.99 | [Fab](https://www.fab.com/listings/ef310a60-0412-41fa-822a-ba4e719f6c90) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | House Forge: Modular House Building Kit (FAB Professional License Key) | $199.99 | [Fab](https://www.fab.com/listings/277b975e-2158-41ef-908a-ef08bc26a409) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | House Forge: Modular House Building Kit (Unity Asset Store Key) | $99.99 | [Unity](https://assetstore.unity.com/packages/3d/props/house-forge-modular-house-building-kit-modular-houses-medieval-h-316665) | .unitypackage (FBX + PNG expected, unverified) | Unity Asset Store EULA | – |
| $25 | Hearthvale: Medieval Houses & Tavern Building Kit (FAB Professional License Key) | $89.99 | [Fab](https://www.fab.com/listings/fb890a55-be4e-45b1-9401-4e6299224e11) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Hearthvale: Medieval Houses & Tavern Building Kit (Unity Asset Store Key) | $59.99 | [Unity](https://assetstore.unity.com/packages/3d/environments/fantasy/hearthvale-medieval-houses-tavern-building-kit-tavern-medieval-h-403134) | .unitypackage (FBX + PNG expected, unverified) | Unity Asset Store EULA | – |
| $25 | Modular Ancient Ruins: Temple & Dungeon Builder (FAB Professional License Key) | $79.99 | [Fab](https://www.fab.com/listings/54093109-eab2-42ff-a0e6-7851f6e3234b) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Modular Haunted Mansion (FAB Professional License Key) | $119.99 | [Fab](https://www.fab.com/listings/434c503b-cd0e-4efb-abc9-347b5ae41b3d) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Modular Haunted Mansion (Unity Asset Store Key) | $79.99 | [Unity](https://assetstore.unity.com/packages/3d/environments/fantasy/modular-haunted-mansion-haunted-mansion-haunted-house-modular-ho-417154) | .unitypackage (FBX + PNG expected, unverified) | Unity Asset Store EULA | – |
| $25 | Modular Haunted House: Haunted House Building Kit (FAB Professional License Key) | $99.99 | [Fab](https://www.fab.com/listings/0dfd4113-17c5-4441-a0c7-4bb3ddb9d18a) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Modular Haunted House: Haunted House Building Kit (Unity Asset Store Key) | $69.99 | [Unity](https://assetstore.unity.com/packages/3d/environments/modular-haunted-house-modular-house-haunted-house-house-home-mod-393284) | .unitypackage (FBX + PNG expected, unverified) | Unity Asset Store EULA | – |
| $25 | Stylized Nature (FAB Professional License Key) | $139.99 | [Fab](https://www.fab.com/listings/cea534a5-0440-426c-a372-d86c474276d2) | uefn, unreal-engine, unity | Fab Standard (Personal/Professional/UEFN - Reference only) | yes |
| $25 | Stylized Nature (Unity Asset Store Key) | $59.99 | [Unity](https://assetstore.unity.com/packages/3d/environments/fantasy/stylized-nature-nature-forest-stylized-forest-forest-pack-nature-268121?srsltid=AfmBOorZimzuW85DEl-58csOUBJZFNb19JnFMSqWEnpq8DQmxi0ZUB9c) | .unitypackage (FBX + PNG expected, unverified) | Unity Asset Store EULA | – |
| $25 | Dungeon Forge: Modular Dungeon Building Kit (FAB Professional License Key) | $159.99 | [Fab](https://www.fab.com/listings/e1e4ccd9-0b33-4d39-b32b-f8245eb55396) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Wildwood: Stylized Forest (FAB Professional License Key) | $89.99 | [Fab](https://www.fab.com/listings/f75e47f5-2efb-42d3-8e35-b520649d15bb) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Wildwood: Stylized Forest (Unity Asset Store Key) | $49.99 | [Unity](https://assetstore.unity.com/packages/3d/environments/wildwood-stylized-forest-stylized-nature-stylized-forest-nature--392734) | .unitypackage (FBX + PNG expected, unverified) | Unity Asset Store EULA | – |
| $25 | Bunker Builder: Modular Bunker Building Kit (FAB Professional License Key) | $119.99 | [Fab](https://www.fab.com/listings/e41cae71-f7a9-4640-a2a4-b6aa40d65a00) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Bunker Builder: Modular Bunker Building Kit (Unity Asset Store Key) | $79.99 | [Unity](https://assetstore.unity.com/packages/3d/environments/historic/bunker-builder-modular-bunker-building-kit-bunker-facility-modul-392736) | .unitypackage (FBX + PNG expected, unverified) | Unity Asset Store EULA | – |
| $25 | Realistic Gun VFX (Unity Asset Store Key) | $49.99 | Unity (link not on Humble page) | .unitypackage (FBX + PNG expected, unverified) | Unity Asset Store EULA | – |
| $25 | Realistic Blood VFX (Unity Asset Store Key) | $39.99 | [Unity](https://assetstore.unity.com/packages/vfx/particles/spells/realistic-blood-vfx-blood-effects-blood-blood-vfx-334130) | .unitypackage (FBX + PNG expected, unverified) | Unity Asset Store EULA | – |
| $25 | Realistic Fire VFX (Unity Asset Store Key) | $39.99 | Unity (link not on Humble page) | .unitypackage (FBX + PNG expected, unverified) | Unity Asset Store EULA | – |
| $25 | Glimvale: Modular Stylized Medieval Open World (FAB Professional License Key) | $79.99 | [Fab](https://www.fab.com/listings/587858fc-892c-4594-a5e0-3d243b00531d) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Glimvale: Modular Stylized Medieval Open World (Unity Asset Store Key) | $39.99 | [Unity](https://assetstore.unity.com/packages/3d/environments/fantasy/glimvale-stylized-fantasy-open-world-modular-medieval-town-medie-314617) | .unitypackage (FBX + PNG expected, unverified) | Unity Asset Store EULA | – |
| $25 | Modular Castle & Dungeon Megapack (FAB Professional License Key) | $159.99 | [Fab](https://www.fab.com/listings/580d5f13-5e27-4f99-8b6b-a2223874d7cc) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Modular Castle & Dungeon Megapack (Unity Asset Store Key) | $139.99 | [Unity](https://assetstore.unity.com/packages/3d/environments/fantasy/modular-castle-dungeon-medieval-castle-castles-dungeons-dungeon--271318) | .unitypackage (FBX + PNG expected, unverified) | Unity Asset Store EULA | – |
| $25 | Modular Medieval Town / Docks (FAB Professional License Key) | $159.99 | [Fab](https://www.fab.com/listings/9bec871e-2d9b-4261-aa26-868d4300f81a) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Modular Destroyed Buildings (FAB Professional License Key) | $159.99 | [Fab](https://www.fab.com/listings/2d532309-f049-4d61-80e8-e8fa63688d35) | unreal-engine, unity | Fab Standard (Personal/Professional) | yes |
| $25 | Modular Destroyed Buildings (Unity Asset Store Key) | $79.99 | [Unity](https://assetstore.unity.com/packages/3d/environments/fantasy/modular-destroyed-buildings-modular-house-houses-modular-buildin-288447) | .unitypackage (FBX + PNG expected, unverified) | Unity Asset Store EULA | – |
| $25 | Modular Sci-Fi Outpost (FAB Professional License Key) | $159.99 | [Fab](https://www.fab.com/listings/15f9685d-89e8-411d-99e2-fc22e0567147) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Modular Sci-Fi Outpost (Unity Asset Store Key) | $79.99 | [Unity](https://assetstore.unity.com/packages/3d/environments/industrial/modular-sci-fi-outpost-sci-fi-outpost-sci-fi-base-sci-fi-outpost-335830) | .unitypackage (FBX + PNG expected, unverified) | Unity Asset Store EULA | – |
| $25 | Modular Medieval Kingdom Megapack (FAB Professional License Key) | $239.99 | [Fab](https://www.fab.com/listings/42d4a792-2b66-423d-9b20-84d6b2c578d8) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Modular Medieval Kingdom Megapack (Unity Asset Store Key) | $139.99 | [Unity](https://assetstore.unity.com/packages/3d/environments/fantasy/medieval-kingdom-medieval-castle-medieval-town-medieval-village--268667) | .unitypackage (FBX + PNG expected, unverified) | Unity Asset Store EULA | – |
| $25 | Pirate Island: Modular Island Megapack (FAB Professional License Key) | $199.99 | [Fab](https://www.fab.com/listings/3074f764-da0c-4b18-8687-1c246fe361f4) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Pirate Island: Modular Island Megapack (Unity Asset Store Key) | $99.99 | [Unity](https://assetstore.unity.com/packages/3d/environments/fantasy/pirate-island-pirate-pirates-island-environment-264853) | .unitypackage (FBX + PNG expected, unverified) | Unity Asset Store EULA | – |
| $25 | Modular Dungeon: Temple Of Cthulhu (FAB Professional License Key) | $99.99 | [Fab](https://www.fab.com/listings/3d9bf3c0-60a4-43e3-8e80-7519ca0fa1f0) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Modular Dungeon: Temple Of Cthulhu (Unity Asset Store Key) | $59.99 | [Unity](https://assetstore.unity.com/packages/3d/environments/dungeons/modular-dungeon-temple-of-cthulhu-dungeon-modular-dungeon-temple-306635) | .unitypackage (FBX + PNG expected, unverified) | Unity Asset Store EULA | – |
| $25 | Sherwood: Modular Medieval Town / Camp (FAB Professional License Key) | $179.99 | [Fab](https://www.fab.com/listings/720ccb75-32a9-4130-acab-532239760d22) | unreal-engine | Fab Standard (Personal/Professional) | no |
| $25 | Sherwood: Modular Medieval Town / Camp (Unity Asset Store Key) | $89.99 | [Unity](https://assetstore.unity.com/packages/3d/environments/fantasy/modular-medieval-town-medieval-town-medieval-village-modular-tow-327089) | .unitypackage (FBX + PNG expected, unverified) | Unity Asset Store EULA | – |
| $25 | Modular Medieval Town / Docks (Unity Asset Store Key) | $79.99 | [Unity](https://assetstore.unity.com/packages/3d/environments/fantasy/modular-medieval-town-docks-medieval-town-medieval-village-town--271319) | .unitypackage (FBX + PNG expected, unverified) | Unity Asset Store EULA | – |
| $25 | Modular Dungeon: Dark Halls (FAB Professional License Key) | $159.99 | [Fab](https://www.fab.com/listings/0ff28c1f-790d-4a1b-92be-04617439270b) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Modular Dungeon: Dark Halls (Unity Asset Store Key) | $79.99 | [Unity](https://assetstore.unity.com/packages/3d/environments/dungeons/modular-dungeon-dungeon-building-kit-dungeon-dungeons-catacomb-t-264856) | .unitypackage (FBX + PNG expected, unverified) | Unity Asset Store EULA | – |
| $25 | Modular Cave: Cave Of Hidden Tomb (FAB Professional License Key) | $159.99 | [Fab](https://www.fab.com/listings/59d4daf0-4424-4ad0-a4b5-47e95ff840aa) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Modular Cave: Cave Of Hidden Tomb (Unity Asset Store Key) | $79.99 | [Unity](https://assetstore.unity.com/packages/3d/environments/dungeons/modular-cave-ancient-cave-ancient-ruins-mayan-ruins-cavern-306634) | .unitypackage (FBX + PNG expected, unverified) | Unity Asset Store EULA | – |
| $25 | Modular Viking Village Megapack (FAB Professional License Key) | $199.99 | [Fab](https://www.fab.com/listings/a72879ea-577a-4125-bde8-25fdd51060cf) | uefn, unreal-engine, unity | Fab Standard (Personal/Professional/UEFN - Reference only) | yes |
| $25 | Modular Viking Village Megapack (Unity Asset Store Key) | $99.99 | [Unity](https://assetstore.unity.com/packages/3d/environments/fantasy/modular-viking-village-medieval-town-medieval-village-modular-in-251976) | .unitypackage (FBX + PNG expected, unverified) | Unity Asset Store EULA | – |
| $25 | Modular Gladiator Arena (FAB Professional License Key) | $119.99 | [Fab](https://www.fab.com/listings/13f7220f-0865-4cac-b80e-d1259c8a8683) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Modular Gladiator Arena (Unity Asset Store Key) | $59.99 | [Unity](https://assetstore.unity.com/packages/3d/environments/historic/modular-gladiator-arena-gladiator-arena-arena-colosseum-arena-327425) | .unitypackage (FBX + PNG expected, unverified) | Unity Asset Store EULA | – |
| $25 | Modular Wooden Buildings (Unity Asset Store Key) | $49.99 | [Unity](https://assetstore.unity.com/packages/3d/props/modular-wooden-buildings-modular-house-houses-modular-building-328816) | .unitypackage (FBX + PNG expected, unverified) | Unity Asset Store EULA | – |
| $25 | Medieval Furniture Props (Unity Asset Store Key) | $39.99 | [Unity](https://assetstore.unity.com/packages/3d/props/furniture/medieval-furniture-props-gothic-props-victorian-props-medieval-f-333978) | .unitypackage (FBX + PNG expected, unverified) | Unity Asset Store EULA | – |
| $25 | Modular Dark Fantasy Graveyard / Cemetery (FAB Professional License Key) | $99.99 | [Fab](https://www.fab.com/listings/a91e07d8-8535-4afd-9125-e8ba9ffdc71a) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Modular Dark Fantasy Graveyard / Cemetery (Unity Asset Store Key) | $49.99 | [Unity](https://assetstore.unity.com/packages/3d/environments/fantasy/modular-dark-fantasy-graveyard-cemetery-horror-cemetery-horror-g-300192) | .unitypackage (FBX + PNG expected, unverified) | Unity Asset Store EULA | – |
| $25 | Duskbane: Modular Medieval Castle (FAB Professional License Key) | $159.99 | [Fab](https://www.fab.com/listings/45cbe62a-55c5-4f9c-8f6c-19486ca663c0) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $25 | Duskbane: Modular Medieval Castle (Unity Asset Store Key) | $79.99 | Unity (link not on Humble page) | .unitypackage (FBX + PNG expected, unverified) | Unity Asset Store EULA | – |

### UltimateCyber / Leartes All-in-One

| Tier | Item | MSRP | Store page | Formats (store) | Licence | NoAI |
|---|---|---|---|---|---|---|
| $5 | SFX Cyberpunk Guns | $80 | no exact Fab match (search hit a different item) | – | – | – |
| $5 | Sedan Car Driveable /Animated/Realistic ( Sedan Car Carr Vehicle Cars Vehicles ) | $40 | [Fab](https://www.fab.com/listings/bd2a2e24-7ec9-4a5c-a688-35305548a726) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $5 | Cosmos 50% Discount Code | $5 | no Fab match | – | – | – |
| $5 | Gumroad 50% Discount Code | $None | no Fab match | – | – | – |
| $5 | Cosmos 1-month Standart subscription | $5 | no Fab match | – | – | – |
| $5 | Unknown Item | $None | no Fab match | – | – | – |
| $15 | Driveable / Animated Excavator ( Driveable Excavator Construction Excavatorr ) | $40 | [Fab](https://www.fab.com/listings/d2a448b3-3150-4ebd-9c67-c5a382b5fc1c) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $15 | HatchBack Car Driveable / Animated / Realistic (HatchBack Car Driveable Vehicle) | $40 | [Fab](https://www.fab.com/listings/d305b8dd-317d-4e1d-84d9-9b85b6399a1c) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $15 | SUV 04 Driveable / Animated / Realistic ( SUV Car Vehicle Cars Vehicles Drive ) | $40 | no exact Fab match (search hit a different item) | – | – | – |
| $15 | Military Barriers Pack ( Military Barriers Barrier Concrete Roadblock 3D Art ) | $80 | [Fab](https://www.fab.com/listings/fbbc8866-f498-440b-aaf7-f04b57371602) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $15 | Ancient Greek Pottery Pack | $40 | [Fab](https://www.fab.com/listings/c51c680a-792b-46cf-ad04-15c5fa7fa2b8) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $15 | SFX Mobile Game | $80 | no exact Fab match (search hit a different item) | – | – | – |
| $15 | VFX Smoke (Unreal Engine) | $60 | no Fab match | – | – | – |
| $30 | Middle Eastern Town Gigapack | $500 | [Fab](https://www.fab.com/listings/405ffca7-aed7-4db8-ab9d-0c80e00a2d7b) | unreal-engine | Fab Standard (Personal/Professional) | no |
| $30 | Demonic Village Environment | $260 | [Fab](https://www.fab.com/listings/04e7146d-05a9-4be4-8b83-958f0af36b7a) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | Neo Tokyo Environment | $260 | [Fab](https://www.fab.com/listings/dc90a348-2a7a-4da7-b843-2d3d2d7cfd2a) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | Modular Stylized Village | $240 | no Fab match | – | – | – |
| $30 | Merlin`s Cave Environment | $180 | [Fab](https://www.fab.com/listings/145b5186-f750-493b-991d-ba5bf23be296) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | Colonial Convent Church Environment | $160 | [Fab](https://www.fab.com/listings/14d933c1-c66a-4313-9e3b-f0966d07ca01) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | Crystals and Crafting Environment | $80 | [Fab](https://www.fab.com/listings/8e053d13-b56e-4117-acf3-de0909594d89) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | Dwarven Dungeon Environment | $160 | [Fab](https://www.fab.com/listings/644a178e-b8ce-4e79-a28b-996ff18dca61) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | Post Apocalyptic Coffee Shop | $120 | [Fab](https://www.fab.com/listings/91dfacd2-b25b-4a2f-a29e-51846ff00529) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | Sorcerer's Hut Environment | $160 | [Fab](https://www.fab.com/listings/3c550fe5-ccc6-401d-b317-65bdff7fa294) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | South American Slums - Favela | $160 | [Fab](https://www.fab.com/listings/07914592-74b5-4ae1-9f0f-b6ea31b202be) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | The Grand Ossuary | $120 | [Fab](https://www.fab.com/listings/b119ce0f-95c7-4b29-a5ca-aae4169a61bc) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | Abandoned Village Environment | $240 | [Fab](https://www.fab.com/listings/2d2e44de-acab-41e9-b163-464224ef00fe) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | Middle Eastern - Ashes of the Bazaar | $160 | [Fab](https://www.fab.com/listings/096b60dc-6fd5-4c09-937f-0d06d60a637f) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | Forgotten Echoes Environment | $200 | [Fab](https://www.fab.com/listings/dc6d3fc4-113f-410e-88af-01a6c268e523) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | Frozen Harbor Fortress | $120 | [Fab](https://www.fab.com/listings/6d4404fc-a961-4996-b4f1-9b9c0a3e314c) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | QA Agent: Crash Reporting & AI Debugging | $200 | [Fab](https://www.fab.com/listings/bf69f012-1dd7-4a56-9969-aed7a525ccbd) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | Project Optimization Toolkit POT (Performance Optimization, Asset Cleaner ) | $60 | [Fab](https://www.fab.com/listings/9b764080-a91d-48ab-9560-050e0120dd04) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | Stylized Eastern Province Environment | $140 | [Fab](https://www.fab.com/listings/b9987090-6b6e-4ea9-b9f6-cedf63489f16) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | Underwater Art Deco Hotel Environment | $120 | [Fab](https://www.fab.com/listings/3cc1beb0-a215-4486-addf-72f51b1b84ed) | unreal-engine, glb | Fab Standard (Personal/Professional) | yes |
| $30 | Container Port Environment | $200 | [Fab](https://www.fab.com/listings/f1c7c996-298b-429f-a34c-aea5e932480f) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | Cyberpunk Apartment | $160 | [Fab](https://www.fab.com/listings/96645bc3-c6c8-449f-b70c-28d6c7194691) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | Fantasy Gothic Castle | $140 | [Fab](https://www.fab.com/listings/4cc0c47e-882c-431a-92f6-839ae4e22299) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | Medieval Tavern | $120 | [Fab](https://www.fab.com/listings/77f981a7-c7a9-4db2-ba1e-8cf2dfc9232f) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | Medieval Castle Interior | $120 | [Fab](https://www.fab.com/listings/09fc4151-3945-4172-bfb5-3f5192a93ffe) | unreal-engine | Fab Standard (Personal/Professional) | no |
| $30 | Cyberpunk Night Club Environment | $120 | [Fab](https://www.fab.com/listings/b03d9b7d-2610-4ee5-9b43-2942ad935880) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | Abandoned / Post-Apocalyptic Hospital | $120 | [Fab](https://www.fab.com/listings/6ff9e884-2b92-4b76-bbef-710f5a6b8da4) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | Victorian Interior | $160 | [Fab](https://www.fab.com/listings/0a0c8009-ad66-440f-b342-6bda3d90b4da) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | Gothic Cathedral | $140 | [Fab](https://www.fab.com/listings/f83f2efd-8cb9-4073-b825-8fd295f1533b) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | Medieval Russian Village | $120 | [Fab](https://www.fab.com/listings/686259e9-aae5-4bcb-b45d-273ecb2038fc) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | Vintage Room | $80 | [Fab](https://www.fab.com/listings/881f6a80-ab70-4147-a513-55633fbd5f08) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | Spanish Cottage | $120 | [Fab](https://www.fab.com/listings/d95a6081-2add-4fe3-ba70-a9e17f6887b6) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | 1900s Office | $120 | [Fab](https://www.fab.com/listings/9c03eb0a-011b-4bc1-9453-3d220d374d2a) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | Minipoly Series - Modern Island City ( Stylized Lowpoly Environment ) | $40 | [Fab](https://www.fab.com/listings/3af76404-4e65-4201-ba10-76de4ce500d8) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | Modular Paris City Street | $100 | [Fab](https://www.fab.com/listings/ddc95c12-26e3-406d-9213-8783f027ad69) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | Stylized Ancient Athens | $120 | [Fab](https://www.fab.com/listings/3c068c89-d38d-45a9-9848-fd0095a0e17c) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | Stylized Ancient Ruins | $120 | [Fab](https://www.fab.com/listings/8b242a0e-af6d-40e2-adbc-7774e5cbfe6c) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | Stylized Lost Civilization | $100 | [Fab](https://www.fab.com/listings/493005ae-2768-4ea2-9392-3f72fb303b0a) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | Post Apocalyptic Playground Equipment VOL.3 ( Post Apocalyptic Survival Prop ) | $40 | [Fab](https://www.fab.com/listings/c43cf9bd-945d-4839-b48b-7005d038fad8) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | Post Apocalyptic Playground Equipment VOL1 (Post Apocalyptic Playground Kid Old) | $60 | [Fab](https://www.fab.com/listings/f57c3b2f-b5bb-4a61-8516-6d810baadaec) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | Post Apocalyptic Playground Equipment VOL.2 ( Post Apocalyptic Apocalypticc ) | $60 | [Fab](https://www.fab.com/listings/309a5fe2-cf12-42c2-86f3-bc092601f101) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | FPS 4K Western Guns - VOL.2 (FPS 4K Western Guns Gun Westerner Weapon Weapons ) | $100 | [Fab](https://www.fab.com/listings/349b7fd8-ee53-467a-a61d-d0fb709f1994) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | FPS 4K Western Guns - VOL.1 ( FPS 4K Western Guns Gun Westerner Weapon Weapons ) | $60 | [Fab](https://www.fab.com/listings/b6c192b9-e31c-4585-8828-8b17f6c9b6ec) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | (5) FPS 4K Custom Modern Handguns - VOL.4 ( Modern Handguns Tactical Pistols ) | $60 | [Fab](https://www.fab.com/listings/1b6428ef-7c6c-4a7d-b832-6aa6a5a0d225) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | FPS 4K Custom Modern Shotguns - VOL.3 (Custom Modern Shotguns Shotgun Weapon 3D) | $60 | [Fab](https://www.fab.com/listings/bfffcffd-d85b-4a68-aa26-2d1efad94e0e) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | Driveable SteamPunk Car / Vehicle ( SteamPunk Car Retro Futuristic Victorian) | $40 | [Fab](https://www.fab.com/listings/16acdb2e-971c-4279-9af6-0600dc609b87) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | City Scooter - Rigged/BP Controllable w/Skins (City Scooter Scooterr Cities) | $40 | [Fab](https://www.fab.com/listings/5d096ce5-1e04-409e-9cf2-35308b61fc1c) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | Military Drone - Rigged/BP Controllable ( Military Drone Militarys Drone 3D ) | $60 | [Fab](https://www.fab.com/listings/00d85b53-0c14-48e3-ac7c-e09ebca65a8c) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | SUV 01 Driveable / Animated / Realistic | $40 | [Fab](https://www.fab.com/listings/c3855821-2aea-485c-955b-a816471e4d4a) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | Classic Car 02 ( Classic Car Cars Driveable Functional Vintage Vehicle Model ) | $40 | [Fab](https://www.fab.com/listings/6876411f-b3a8-4add-9f63-6deacdc579ae) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | Police Character / NPC ( Police Character Policee Policeman Officer Uniform ) | $40 | [Fab](https://www.fab.com/listings/879f876d-0c63-4a23-8e86-7f12cbce874c) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | 1950s Businessman / Mafia Character / NPC / Rigged (1950s Businessman Mafia) | $40 | [Fab](https://www.fab.com/listings/bba4384a-5165-4fc8-929c-bff8544ab3bb) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | Sourwood Trees ( Sourwood Trees Tree Nature Forest Vegetation 3D Prop Art ) | $40 | [Fab](https://www.fab.com/listings/014d1146-77f1-4b9b-b30d-43fcc40e3b7b) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | Cyberpunk Sports Hover | $40 | [Fab](https://www.fab.com/listings/bcee6be6-a8c8-4ec0-878f-447755881ffa) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | Roman Statues Pack Vol 2 | $60 | [Fab](https://www.fab.com/listings/ea5378a1-1876-433b-a8f3-afa3db02fb96) | unreal-engine | Fab Standard (Personal/Professional) | yes |
| $30 | Minotaur Statue (Minotaur Statue Statues Sculpture Ancient Roman Prop 3D Art) | $20 | [Fab](https://www.fab.com/listings/67568fb0-01a9-4965-ad53-7ab72059434a) | unreal-engine, blender, glb | Fab Standard (Personal/Professional) | yes |
| $30 | SFX Cyberpunk | $80 | no exact Fab match (search hit a different item) | – | – | – |
| $30 | SFX Character Movement | $80 | no Fab match | – | – | – |
| $30 | SFX Footsteps Crouch | $80 | no Fab match | – | – | – |
| $30 | SFX Medieval Armor & Body Impact Pack | $80 | no Fab match | – | – | – |
| $30 | Warzone VFX Pack | $140 | no Fab match | – | – | – |
| $30 | VFX Explosion (Unreal Engine) | $80 | no Fab match | – | – | – |
