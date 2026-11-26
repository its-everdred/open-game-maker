# What a new game can use (snapshot 2026-11-03)

Confirm against the live repo and catalog before promising anything: `gm assets search|facets|info`, `gm maps search`,
`gm packs search --camera <camera> --setting <setting> --style <family>`, `gm packs scenes --setting <setting>`,
the style families API (`/api/catalog/style-families`) and the templates. Pack and scene metadata may be incomplete;
an empty result is not proof that no suitable source exists. Lines marked **Planned** do not exist yet.

## Engine and hosting (built)

- **Two engines, one SDK.** 2D games use Phaser; 3D games use Three.js with Rapier physics. Both run on `@gm/sdk`:
  `core` (game loop, fixed step, seeded RNG), `input` (actions for touch, keyboard, gamepad, multiple local players),
  `audio` (shared mix with music, sound and voice buses; spoken lines with captions), `camera`, `fx` (particles and
  pixel effects), `nav` (pathfinding), `proc` (procedural generation helpers), `saves` (slots that persist per player),
  `achievements`, `analytics`, plus `phaser` and `three` bindings and test hooks.
- **Templates:** `game-2d`, `game-3d`, `game-multiplayer` (rooms). A game is a folder `games/<name>/` in the instance
  repo, with shared code in `packages/`.
- **Pack adapters (L2):** `smallscaleint` (isometric 8-direction sprites, maps, sprite actor), `kaykit` (rigged 3D
  characters with shared animations, modular kit placer), `limezu-modern` (top-down maps with autotiling, layered
  character sprites). Other packs are used directly through asset cards.
- **Game skills** agents load: gm-core, gm-genre-platformer, gm-input, gm-ui-hud, gm-audio, gm-multiplayer-ready,
  gm-editor-tuning, gm-3d (Blender offline authoring), gm-video, gm-voiceover, gm-verify, gm-repair, gm-set-<set>.
- **Hosting:** each build is served by the instance's games host inside the app, playable on phones and desktops;
  multiplayer through the rooms service; builds, releases, publish and rollback per game.
- **Verification:** `gm check`, `gm test`, `gm run`, `gm shot`, `gm perf` (frame and size budgets for phones).
- **Genres with dedicated guidance:** platformer. Other genres are built from the core skills and pattern cards.

## Limits to respect

- Phone-first: keep within the `gm perf` budgets; 3D scenes stay modest (low-poly packs, limited lights and draw calls).
- Builds run network-off: no runtime calls to outside services from the game.
- One style family per game.
- No online leaderboards or accounts inside games beyond the platform's saves, achievements and rooms.
- Voice lines: short, local drafts (gm-voiceover) or the platform's ElevenLabs voices (cost per new voice).
- **Planned:** starter scenes from showcase dioramas, an in-editor map painter, two-way voice in the app (wiring now).

## Visual styles (style families on the creation screen)

| Family | Dimension | Views | Packs | Examples |
|---|---|---|---|---|
| Chunky low poly | 3D | iso, topdown, follow, orbit | 78 | Kenney kits (castle, nature, fantasy town, graveyard, pirate, survival, furniture), KayKit set |
| Detailed low poly | 3D | follow, orbit, fps, iso | 11 | Synty POLYGON (Viking realm, goblin war camp, alpine biomes, shops, prototype, particle FX) |
| Simple low poly | 3D | iso, orbit, follow, topdown | 2 | Synty simple buildings, props and icons |
| Pixel art | 2D | topdown, side | 45 | LimeZu Modern and Fantasy, Kenney 1-bit, pixel platformer, tiny town and dungeon, roguelike |
| Flat cartoon | 2D | side, topdown | 100 | Kenney platformer, toon characters, space shooter, tower defense, animals, physics assets |
| Isometric 2D | 2D | iso | 49 | SmallScaleInt (8-direction animated characters, creatures, buildings, dioramas), Kenney isometric |
| Sketch | 2D | side, topdown, iso | 6 | Kenney sketch town, scribble dungeons and platformer |

The SmallScaleInt set has a live showcase (v4): eight looping scenes (forest ambush, desert caravan, dinosaur
crossing, market town, farm, zombie city, house interior, graveyard) plus sprite sheets. They show what the set can
depict; they are references and regression fixtures, not ready-made levels.

## Audio library

- **Music:** Sidetrax (128 packs of human-made loops and tracks, usable in games), Abstraction music loops (11 packs),
  Pixabay curated playlists (554 tracks across 20 moods), Kenney music loops.
- **Sound effects:** Kenney audio packs (UI, impacts, foley, sci-fi, RPG, retro), Sonniss GDC bundles (very large
  professional SFX library, 2016–2024).
- **Status:** Kenney and part of Sidetrax are catalogued for search; Sonniss, Pixabay and the music loops are imported
  but **not yet tagged** (searching them by mood needs the planned asset-searchability work).

## Using owned assets

All packs are owned or freely licensed and usable in the instance's games. Licensed files are never committed to a
public repository and never sent to outside processing services; games reference them from the instance's library.
