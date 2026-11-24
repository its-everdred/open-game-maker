# Free and open animation libraries for the hero bodies (2026-11-24)

Kevin, 2026-11-24 ~00:20Z: "find free and open source animation packs, there has to be some libraries of resources". Every source below has a link. Where a preview exists, it is linked too; "no preview found" means none was found this pass.

Earlier reports: `docs/research/2026-11-23-hero-animation-tools/report.md` and `docs/research/2026-11-23-animation-packs/report.md`.

## What we need
- **Rig:** the 3D base bodies use the Mixamo skeleton (Meshy `mixamo` template). Clips already on the Mixamo skeleton need no bone mapping.
- **Motion now:** a hunched, guarded axe walk and a big overhead axe swing, matching 6Barbarian.
- **Motion later:** run, roll, block, hit, fall, push, staff casting and bow shots, for male and female bodies.
- **Licence:** the game is family-only and private, so non-commercial terms are fine.
- **Already tried:** Quaternius UAL, Bandai Namco, LaFAN1 and CMU, through our own retarget chain. The chain is the likeliest culprit, so these sources are not ruled out.

## Key findings
1. **Mixamo still works and is the only free source on our exact skeleton.** A guide updated in September 2026 confirms it is up ([Cinevva](https://app.cinevva.com/guides/free-character-animations-rigging)). Its terms allow free use with no royalties ([Adobe FAQ](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html)). It has guarded sword walks, overhead strikes, block, roll, push, falls, casting and bow clips. Downloads are manual, one clip at a time, through the web GUI.
2. **KayKit Character Animations is already on the NUC and covers most of the list.** It is CC0, at `assets-local/packs/kaykit-character-animations`. Clip names were read from the GLBs on disk:
   - Melee: `Melee_1H_Attack_Chop`, `Melee_1H_Attack_Jump_Chop`, `Melee_2H_Attack_Chop`, `Melee_2H_Idle`, `Melee_Block`, `Melee_Blocking`, `Melee_Block_Hit`
   - Movement: `Dodge_Forward/Backward/Left/Right`, `Sneaking`
   - Ranged: `Ranged_Bow_Draw`, `Ranged_Bow_Release`
   - Magic: `Ranged_Magic_Spellcasting`, `Ranged_Magic_Shoot`
   - Reactions: `Hit_A/B`, `Death_A/B`

   It has no guarded walk. Its rig has chibi proportions, so a retarget must remap the bone lengths.
3. **100STYLE has hunched and guarded walk styles.** It is CC BY 4.0 BVH, and its styles include `Crouched`, `BentForward`, `BentKnees`, `ShieldedLeft/Right`, `Heavyset`, `Swat` and `Lunge`. Locomotion is the dataset's best material, and a hunched walk is what Kevin rejected us for.
4. **Kevin Iglesias's free samplers are the only free clips with masculine and feminine versions.** The melee, archer and spellcasting samplers each come in both versions. Together they give one two-handed attack, combat idles, a bow shot and 5 spell attacks.
5. **No free source has a dedicated axe set.** The usable overhead chops are KayKit `Melee_2H_Attack_Chop`, `Melee_1H_Attack_Chop` and Mixamo's downward strikes. Fab's free rotation (until Dec 1) has no animations, and its sword and axe listings are all paid.

## Survey

Effort to the Mixamo skeleton:
- **none:** same bone names;
- **low:** standard humanoid, name map only;
- **medium:** different proportions or bone count;
- **high:** raw mocap skeleton, cleanup needed.

### Free libraries and packs

| Source | Licence | Format, skeleton | Effort | Guarded walk | Overhead axe/chop | Staff cast | Bow | Roll | Block | Preview |
|---|---|---|---|---|---|---|---|---|---|---|
| [Mixamo](https://www.mixamo.com) | free, no royalties, any use; no redistribution or ML training ([FAQ](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html)) | FBX, Mixamo skeleton | none | yes: sword-and-shield and great-sword walks (clip names not checked this pass) | yes: downward melee strikes and great-sword slashes; no axe set | yes: 1H and 2H casts | yes: draw, aim, shoot | yes | yes | live 3D preview of every clip on mixamo.com |
| [KayKit Character Animations](https://kaylousberg.itch.io/kaykit-character-animations) (**on disk**) | CC0 | FBX, GLTF; KayKit Rig_Medium/Large | medium (chibi proportions) | no (`Sneaking`, `Melee_2H_Idle` for the stance) | yes: 1H and 2H chops | yes | yes | dodges ×4 | yes | itch page stills; [OpenGameArt](https://opengameart.org/content/kaykit-character-animations); no video found |
| [Quaternius UAL 1](https://quaternius.com/packs/universalanimationlibrary.html) (**free Standard on disk**) | CC0 | FBX, GLB; universal humanoid, "compatible with Mixamo" | low | no | `Sword_Attack` only | `Spell_Simple_*` | no | `Roll` | no | [anim viewer](https://quaternius.com/animviewer.html), [video](https://youtu.be/-VXFlXhvD6A) |
| [Quaternius UAL 2](https://quaternius.itch.io/universal-animation-library-2) | CC0 (42 clips free; full set $14.99) | FBX, GLB; same rig as UAL 1 | low | no | `SWORD_REGULAR_A` combos, `OVERHAND_THROW` | no | no | no | `IDLE_SHIELD` | [anim viewer](https://quaternius.com/animviewer.html) |
| [Kevin Iglesias Human Melee FREE](https://kevdev.itch.io/human-melee-animatons-free) | free sampler; licence text not on page | FBX, Blender; Unity/Godot humanoid; **male + female** | low | combat idles per weapon style | 1 two-handed attack, 1 right-hand attack | — | — | no | no | [clip list](https://keviniglesias.com/documentation/Human%20Melee%20Animations.pdf); only a retarget tutorial video |
| [Kevin Iglesias Archer FREE](https://kevdev.itch.io/human-archer-animations-free) | as above | as above, male + female | low | 8-direction walk (not guarded) | — | — | 1 front shot, draw/sheathe | no | no | only tutorial videos |
| [Kevin Iglesias Spellcasting FREE](https://kevdev.itch.io/human-spellcasting-animations-free) | as above | as above, male + female | low | — | — | casting idle + 5 spells | — | no | no | [clip list](https://www.keviniglesias.com/documentation/Human%20Spellcasting%20Animations%20FREE.pdf) |
| [Kevin Iglesias Basic Motions FREE](https://kevdev.itch.io/basic-motions-free) ([Unity](https://assetstore.unity.com/packages/3d/animations/basic-motions-free-154271), [Gumroad](https://keviniglesias.gumroad.com/l/human-basic-motions-free)) | free sampler; Unity EULA on Unity | FBX; humanoid, male + female | low | no (idles, walks, jumps) | — | — | — | no | no | Unity page carousel |
| [Melee Warrior Animations FREE](https://assetstore.unity.com/packages/3d/animations/melee-warrior-animations-free-165785) (Unity copy of the melee sampler) | Unity Asset Store EULA | FBX, Unity humanoid | low | combat idle | right-hand and shield attacks | — | — | no | no | Unity page |
| [Rokoko: 13 free fight animations](https://www.rokoko.com/resources/rokoko-mocap-13-free-fight-animations) | any project, commercial included; email sign-up | FBX, **Mixamo skeleton**, 30 fps | none | fight stance (unarmed) | no | no | no | not listed | not listed | page videos only |
| [Rokoko: 16 free walk and run cycles](https://www.rokoko.com/resources/rokoko-mocap-16-free-walk-and-run-cycle-animations), [10 idles](https://www.rokoko.com/resources/rokoko-mocap-10-free-everyday-idle-animations) | as above | FBX, Mixamo skeleton | none | probably not | — | — | — | — | — | page videos only |
| [Rokoko Motion Library](https://www.rokoko.com/motion-library) free items | Rokoko terms | FBX via Rokoko Studio | low | varies | — | — | — | — | — | per clip in the library |
| [Anderson Rohr free mocap](https://andersonrohr.gumroad.com/l/free_mocap1) ([pack 2](https://andersonrohr.gumroad.com/l/free_mocap2); [news, Sep 2026](https://www.cgchannel.com/2026/09/download-130-free-fbx-mocap-moves-from-anderson-rohr/)) | commercial use, no attribution; pay what you want ($0) | FBX on Rokoko, iClone and UE5 Manny skeletons | low | no (everyday, crowd, fitness, soccer) | no | no | no | no | no | Gumroad pages |
| [ActorCore free motions](https://actorcore.reallusion.com/) ([free content](https://actorcore.reallusion.com/campaigns/askNK/default.html)) | Reallusion licence; account needed | FBX, CC skeleton | low | a forum post says only 32 free motions ([thread](https://discussions.reallusion.com/t/where-are-the-4000-free-motions/16707)) | no free combat found | — | — | — | — | per motion on site |
| [Truebones free 4 mocap files](https://truebones.gumroad.com/p/free-4-mocap-files-in-fbx-bvh-and-i-clone-format) | licence not stated; free via a rotating code | FBX, BVH | medium | unknown | unknown | — | — | — | — | none |
| [Xsens free mocap](https://www.xsens.com/entertainment/free-xsens-motion-capture-animation-assets) | licence not stated on pages | FBX, MVN T-pose | medium | walk/run, sports, dance only | no | no | no | no | no | per download page |
| [Rigonix3D](https://rigonix3d.com/) | not found | 300+ free clips claimed in 2025 | unknown | unknown | unknown | — | — | — | — | browser preview (claimed) |
| [Mesh2Motion](https://mesh2motion.org/) ([app](https://app.mesh2motion.org/), [code](https://github.com/mesh2motion/mesh2motion-app), [assets](https://github.com/Mesh2Motion/mesh2motion-assets)) | code MIT, art CC0 | GLB export; its own human rig, Quaternius-based library | n/a (rigs our mesh itself) | — | — | — | — | — | — | live in the app; [GameFromScratch](https://gamefromscratch.com/mesh2motion-open-source-mixamo-alternative/) |
| [RancidMilk CMU library](https://rancidmilk.itch.io/free-character-animations) | free to use and modify; don't sell the animations | 2,000+ FBX/glTF on a Quaternius character (Auto-Rig Pro) | low | no combat | no | no | no | — | — | [Vimeo](https://player.vimeo.com/video/775513861) |

### Characters with built-in animations (CC0 / CC-BY)
These are useful as arm-0 controls, or as references, not as our rig.

| Source | Licence | Notes | Preview |
|---|---|---|---|
| [Kenney animated characters](https://kenney.nl/assets) (**on disk**, 4 packs) | CC0 | idle, run, jump, simple attacks; small rigs | kenney.nl |
| [Quaternius LowPoly Animated Knight](https://opengameart.org/content/lowpoly-animated-knight) | CC0 | idle, walk, run, roll, death, sword attacks; weapon on `Palm.R` | OGA page |
| [Low poly hero with sword and shield](https://opengameart.org/content/animated-low-poly-hero-with-sword-and-shield) | CC0 | walk, attack, defend, hurt, death; glTF | OGA page |
| [Skeleton with axe (OGA 89457)](https://opengameart.org/node/89457) | CC0 | 3 axe attacks | OGA page |
| [Modular RPG Characters](https://opengameart.org/content/modular-rpg-characters) | CC0 | male + female, about 45 clips each (one comment found only idles in the blends) | OGA page |
| [GDQuest Mannequiny](https://github.com/GDQuest/godot-3d-mannequin) | CC-BY 4.0 | Godot locomotion set | GitHub |
| [Sketchfab executioner with two-handed axe](https://sketchfab.com/3d-models/executioner-warrior-hooded-axe-armor-9924a0f56d164b29abf0c3bf0b2b2333) | CC-BY 4.0 | the page lists no rig or animations, so mesh only | Sketchfab viewer |

Sketchfab's CC-BY animated rigs are case by case. No CC-BY rig found this pass had a guarded axe walk.

### Research datasets

| Dataset | Licence | Format, skeleton | Effort | Combat content | Preview |
|---|---|---|---|---|---|
| [100STYLE](https://www.ianxmason.com/100style/) ([Zenodo](https://zenodo.org/record/8127870), [retargeted FBX](https://github.com/orangeduck/100style-retarget)) | CC BY 4.0 (credit "The 100STYLE Dataset - Ian Mason") | BVH, 28-bone Xsens skeleton, 60 fps | medium | walk styles `Crouched`, `BentForward`, `BentKnees`, `ShieldedLeft/Right`, `Heavyset`, `Swat`, `Lunge`, `Punch`, `KarateChop`, `Kick` | "Dataset Video" on the project page |
| [Bandai Namco Research Motion](https://github.com/BandaiNamcoResearchInc/Bandai-Namco-Research-Motiondataset) (**on disk**) | CC BY-NC 4.0 per the README (a 2022 article said BY-NC-ND) | BVH | medium | dataset 1 has fighting in 15 styles; no weapons | README |
| [CMU Graphics Lab](https://mocap.cs.cmu.edu/) ([BVH by cgspeed](https://sites.google.com/a/cgspeed.com/cgspeed/motion-capture)) (**on disk**) | free for research; may ship in products, may not resell the data | ASF/AMC, BVH | high | little; some boxing | per-take videos on the site |
| [LaFAN1](https://github.com/ubisoft/ubisoft-laforge-animation-dataset) (**on disk**) | CC BY-NC-ND 4.0 | BVH | medium | some fights; no weapons | GitHub |
| [ACCAD Open Motion](https://accad.osu.edu/research/motion-lab/system-data) | CC BY 3.0 | BVH, C3D, AMC; MOV reference videos | high | Male 2 martial arts (stances, kicks, punches), C3D only | MOV files on the page |
| [SFU Motion Capture](http://mocap.cs.sfu.ca/) | licence not found | BVH, 120 fps | high | a little martial art | per-take on site |
| [AMASS](https://amass.is.tue.mpg.de/) ([licence](https://amass.is.tue.mpg.de/license.html)) | non-commercial research, education and art; registration needed | SMPL-H parameters | high (SMPL to skeleton) | aggregates CMU, SFU and others | site |
| [HumanML3D](https://github.com/EricGuo5513/HumanML3D) | built from AMASS and HumanAct12, so the AMASS terms carry over | SMPL joints and text labels | high | text-searchable, but little weapon combat | — |
| [Motion-X](https://github.com/IDEA-Research/Motion-X) ([licence](https://motion-x-dataset.github.io/static/license/Motion-X%20License.pdf)) | CC BY-NC-SA 4.0, plus each sub-dataset's terms | SMPL-X | high | some martial arts and kung fu from video | GitHub |

### Stores, engines and community hubs
- **[Fab limited-time free](https://www.fab.com/limited-time-free):**
  - The rotation runs every two weeks. The current one, until Dec 1, has no animation packs.
  - Past rotations found, from Aug to Nov 2026, had no animation packs either.
  - Fab's sword and axe packs are paid, such as GameDevHero Axe Combat V1 from the last report.
  - [GameDevHero's free 108-clip sample](https://forums.unrealengine.com/t/gamedevhero-gdh-animation-sample-free-if-join-discord/2690775) needs their Discord.
- **[Unreal Game Animation Sample](https://www.unrealengine.com/en-US/blog/game-animation-sample-project-is-now-available):**
  - It has 500+ high-quality clips on the UE5 mannequin.
  - Using them outside Unreal is unclear; forum consensus says don't ([thread](https://forums.unrealengine.com/t/can-you-use-the-game-animation-sample-in-a-game/2032123)).
  - It is private use only at best, and has no axe set.
- **Unity Asset Store free:**
  - Basic Motions FREE and Melee Warrior FREE are in the table.
  - The free "Sword Animation" pack ([314514](https://assetstore.unity.com/packages/3d/animations/sword-animation-314514)) is deprecated and no longer downloadable.
  - The RPG Character Mecanim FREE sample is named on [the paid page](https://marketplace.unity.com/packages/3d/animations/rpg-character-mecanim-animation-pack-63772), but its own listing was not found.
- **[OpenGameArt](https://opengameart.org/):** CC0 mirrors of KayKit and UAL, plus the characters above.
- **[itch.io free animations](https://itch.io/game-assets/free/tag-animation):** mostly 2D sprite sheets. The 3D finds are KayKit, Quaternius, Kevin Iglesias and RancidMilk.
- **Godot:**
  - [Godot Asset Store: UAL](https://store.godotengine.org/asset/quaternius/universal-animation-library/).
  - [MixaBridge](https://godotengine.org/asset-library/asset/5096) imports Mixamo clips.
  - No Godot-only motion library found.
- **Blender:**
  - Mesh2Motion (above) is the open-source auto-rig plus library.
  - The [Retarget add-on](https://extensions.blender.org/add-ons/retarget/) (GPL) has Mixamo presets but needs Blender 5.0; the NUC runs 4.3.
  - No Blender-community combat motion library found.

## Top 8 for our needs

| # | Source | Why | Gap | Cost, effort |
|---|---|---|---|---|
| 1 | [Mixamo](https://www.mixamo.com) | Same skeleton as our bodies, so no retarget chain. Guarded sword walks, overhead strikes, block, roll, push, fall, hit, cast and bow in one library | GUI only, one clip at a time; no axe set; female-styled clips are few | $0; Kevin or the Executor clicks the downloads (about 15 clips) |
| 2 | [KayKit Character Animations](https://kaylousberg.itch.io/kaykit-character-animations) | **Already on disk**, CC0. 1H and 2H chops, block, 4 dodges, bow draw and release, spellcasting, hit | Chibi proportions; no guarded walk | $0; medium retarget |
| 3 | [100STYLE](https://www.ianxmason.com/100style/) | The hunched walk: `Crouched`, `BentForward`, `BentKnees`, `ShieldedLeft/Right`, `Heavyset`; CC BY 4.0 | Locomotion only; 28-bone BVH | $0; medium retarget, or [orangeduck's retargeted FBX](https://github.com/orangeduck/100style-retarget) |
| 4 | [Kevin Iglesias free samplers](https://kevdev.itch.io/) ([melee](https://kevdev.itch.io/human-melee-animatons-free), [archer](https://kevdev.itch.io/human-archer-animations-free), [spells](https://kevdev.itch.io/human-spellcasting-animations-free)) | Only free set with **male + female** versions; 2H attack, combat idles, bow shot, 5 spells; paid sets are the upgrade path | One attack per weapon style; licence text not on the page | $0; about 45 MB; low retarget |
| 5 | [Rokoko free fight + walk packs](https://www.rokoko.com/resources/rokoko-mocap-13-free-fight-animations) | Real mocap on the **Mixamo skeleton**; fight stances for a guarded idle and walk | Unarmed; email sign-up | $0; none |
| 6 | [Quaternius UAL 1 + 2](https://quaternius.com/packs/universalanimationlibrary2.html) | CC0, UAL 1 on disk. Roll, push, hit, simple spell, sword combos, shield idle | Already rejected through our broken chain; re-test through the plain retarget | $0; low |
| 7 | [Bandai Namco dataset 1](https://github.com/BandaiNamcoResearchInc/Bandai-Namco-Research-Motiondataset) | **On disk**; human mocap with fighting in 15 styles; non-commercial is fine for us | No weapons | $0; medium |
| 8 | [Mesh2Motion](https://app.mesh2motion.org/) | MIT/CC0 auto-rig plus library in the browser: a free outside check of whether our rig or our retarget is broken | Library is Quaternius-based, nothing new; GLB only | $0 |

Ranked out:
- Anderson Rohr, RancidMilk/CMU, ACCAD and Xsens have no combat.
- ActorCore free and Truebones free are too small, or their terms are unclear.
- AMASS, HumanML3D and Motion-X are SMPL research data with heavy conversion work.
- The Unreal GASP licence is unclear outside Unreal.
- Fab has no free animations now.

## Recommendation
1. **Use the KayKit clips already on disk first.** Play `Melee_2H_Attack_Chop`, `Melee_1H_Attack_Chop`, `Melee_Block`, `Dodge_Forward`, `Ranged_Bow_Release` and `Ranged_Magic_Spellcasting` on the Warrior body through the bake-off's plain name-mapped retarget (arm C, core #1282). Render them beside 6Barbarian Attack1. This costs nothing and needs no download.
2. **Get Mixamo clips for the walk and the swing.** Pull about 15 clips as FBX "without skin": the guarded sword walks, downward strikes, block, roll, push, fall, hit, 2H cast and bow shot. They go onto our Mixamo-template bodies with no retarget, which separates "bad data" from "broken chain" cleanly. Mixamo needs an Adobe login in a browser, so a person or a browser session has to do the downloading.
3. **For the hunched walk, try 100STYLE.** Use `Crouched`, `BentForward` or `ShieldedRight`, starting from orangeduck's pre-retargeted FBX, and credit Ian Mason.
4. **For female bodies,** take the Kevin Iglesias free samplers (male + female, about 45 MB). If they work, the paid sets from the last report are the next step.

## Unverified
- Mixamo clip names (Great Sword Walk, Sword And Shield Walk, Standing Melee Attack Downward, Standing 2H Cast Spell, Standing Draw Arrow, Stand To Roll and so on) are from memory. This pass did not confirm them on mixamo.com.
- The licence text of the Kevin Iglesias free samplers is not on their pages; the support address is on the pages.
- The licences of Rigonix3D, Truebones free, Xsens free and SFU were not found.
- Nothing was downloaded. The KayKit and UAL 1 clip lists come from the copies already on disk.

Sources: every link above, plus [Mixamo status (Cinevva, Sep 2026)](https://app.cinevva.com/guides/free-character-animations-rigging), [Mixamo 2025 outage thread](https://community.adobe.com/questions-696/mixamo-down-589830), [Fab free program](https://forums.unrealengine.com/t/fab-limited-time-free-content/2738884), [Anderson Rohr news](https://80.lv/articles/get-free-motion-capture-animations-every-month-for-one-year) and [AMASS licence](https://amass.is.tue.mpg.de/license.html).
