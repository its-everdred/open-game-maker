# Animation packs for the hero sprites (2026-11-23)

## Target
- **Walk:** match 6Barbarian Walk: hunched, on guard, axe ready.
- **Attack:** match 6Barbarian Attack1: a big overhead swing with follow-through. In the pack, the barbarian swings a **one-handed** axe.
- **Later:** run, roll, block, hit, fall, push and several attacks per class, for male and female bodies, with gear as layers.

## Main finding: Kevin owns a layered SmallScaleInt hero kit
His itch.io library lists **Character Creator 2D – Fantasy**, which was never installed. Checked on disk (v1.3):
- **Format:** the same sheet format as 6Barbarian: 1920×1024 sheets of 128 px frames, 15 frames × 8 directions, figure at the same scale.
- **Base bodies:** human, undead and spirit. **There is no female body.**
- **Gear layers:** greyscale and tintable, with one sheet per animation:
  - Head 23, Chest 19, Legs 9, Shoes 5, Hands 4, Belt 2, Bag 7
  - Melee 25 (axes included), Ranged 7 (bows), Magic 3, Shield 7, Offhand 2
  - Slash 2, Effect 5, Mount 5
- **30 animations:**
  - attacks: Attack1–6, Kick, AttackRun ×2
  - movement: Walk, Run, RunBackwards, StrafeLeft/Right, Rolling, Slide, CrouchIdle, CrouchRun
  - idles: Idle 1–4, Taunt
  - reactions: TakeDamage, Die, Special1
  - riding: 4 animations
  - **No block and no push.**
- **Licence:** use in our own games is fine; reselling or redistributing the sheets is not.

Compared side by side with 6Barbarian:
- **Walk:** upright and relaxed, the same problem Kevin rejected.
- **Attack1:** a lunge, not his overhead swing.
- **Attack4:** a two-handed overhead raise-and-chop with follow-through, the closest motion we have.

**Owned HD heroes, usable as they are:**
- **Characters:** Knight, Paladin, Wizard, Mage, Archer, Longbow, Barbarian, Berserker and others.
- **Animations:** about 30 each, including Walk, Run, Attack1–3, Block, Rolling, TakeDamage and Die.
- **Limits:** they are fixed characters, with no gear layers and no male/female pairs.

## Top 3 for the Warrior walk and attack

| # | Pack | Price | Guarded walk | Overhead axe swing | Format and rig | Retarget to Mixamo | Licence |
|---|---|---|---|---|---|---|---|
| 1 | SmallScaleInt Character Creator Fantasy (owned) | $0 | no | yes (Attack4, two-handed) | 2D PNG layers | not needed | own-game use |
| 2 | GameDevHero Axe Combat V1 ([Fab](https://www.fab.com/listings/73ae5804-1a3c-4fa4-a0ba-4425e063b8f7), [video](https://youtu.be/7ER_T8u65K0)) | $19.99 | likely: the preview shows crouched guard stances; 8-direction walk | 30 attacks; one-handed axe; no overhead swing named | 361 FBX files, UE5 mannequin | moderate | Fab Standard licence |
| 3 | 2Handed Hammer Animset ([Unity](https://assetstore.unity.com/packages/3d/animations/2handed-hammer-animset-154725)) | $69.99 | not verified | yes by its preview: heavy two-handed slams | Unity Humanoid FBX | moderate | Unity Asset Store EULA |

## Packs covering all three classes
- **Character Creator Fantasy (owned):** melee, magic and bows. Male only.
- **Owned HD heroes:** all three classes, as fixed characters.
- **Kevin Iglesias** Human Melee + Spellcasting + Archer ([itch](https://kevdev.itch.io/human-melee-animations)):
  - **Price:** $11.50 + $14 + $12 = **$37.50** in the Black Friday sale, or $65 for 8 packs.
  - **Male + female:** every clip comes in masculine and feminine versions.
  - **Format:** FBX plus Blender files.
  - **Combat:** 4 two-handed and 10 one-handed attacks, a two-handed combat idle, parry, dodge, and bow and casting sets.
  - **Weakness:** the walks are generic, with no weapon-ready walk.
- **Mixamo:** free, with great sword, magic and longbow sets. Downloads have been unreliable since mid-2025.

## Others checked, not shortlisted
- **Synty Sword Combat** ($59.99): one-handed sword only, and it only works on Synty's own rigs.
- **TeamZ two-handed (female)** ($45): Unity; its contents couldn't be read.
- **Soullike Axeman** ($35): Unity; its contents couldn't be read.
- **Explosive RPG Character Mecanim** ($59.99): Unity; broad but dated.
- **Reallusion Axe Motion** ($11.25): needs iClone to export.
- **ActorCore:** sold per motion; no axe set found.
- **MoCap Online:** no axe pack found, and no BVH files.
- **Rokoko:** sold per clip.
- **Bandai Namco, CMU, LaFAN1, Quaternius:** these are the free sources Kevin already rejected in rounds 1–2.

## Total cost
- Rank 1 alone: **$0**.
- Ranks 1 + 2: **$19.99**.
- All top 3: $89.98.
- Adding Kevin Iglesias for female bodies and all three classes in 3D: +$37.50.

## Recommendation
1. **Free, now:** install the owned creator with `gm-asset-intake`, build a Warrior from the base body plus an axe layer, and show its Attack4 beside 6Barbarian.
2. **For the guarded walk:** buy GameDevHero ($19.99) and render one test cell of its walk on our male base body. Watch its demo video first to confirm the walk keeps the guard.
3. **For female bodies:** use the Kevin Iglesias clips on our 3D base bodies, or hand-edit pixel frames of the creator's body.

Sources: the store pages linked above, plus [Character Creator Fantasy](https://smallscaleint.itch.io/character-creator-2d-fantasy), the [Human Melee clip list](https://keviniglesias.com/documentation/Human%20Melee%20Animations.pdf), [Archer](https://kevdev.itch.io/human-archer-animations), [Spellcasting](https://kevdev.itch.io/human-spellcasting-animations), [Synty](https://syntystore.com/products/animation-sword-combat), [Reallusion](https://reallusion.com/contentstore/pack/axe-motion) and [Mixamo status](https://community.adobe.com/questions-696/mixamo-down-589830).


## Decision
Kevin 2026-11-23 ~23:30Z: install the owned Character Creator 2D Fantasy (free). No purchases.
