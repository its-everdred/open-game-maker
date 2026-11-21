---
name: gm-image-mock
description: Load at the start of any visual design review (a new game's look, a restyle, a screen, character or aesthetic options). Step 1 of game design prototyping: generate pure image mock-ups of exactly what the player will see, informed by the chosen kit, and show them as options before any real-asset diorama or build work.
---

# Image mocks: review step 1

Follow the image sizing rule in `gm-ui-hud`: never scale images non-uniformly; use 9-slice or separate pieces for
resizable art, and generate a separately named asset at the exact slot aspect ratio for a new shape. State its pixel
size in the prompt and mark it AI-generated as usual. Include the distortion gate's output in the verify checklist.

**Every image is an aspect set** (creator, 2026-11-20: "make all images work for all device sizes and aspect ratios include phones"). Anything a player or the creator sees (thumbnail, logo lockup, loading and title art, backgrounds, panels, and the review images themselves) is made for phone portrait (390x844), phone landscape (844x390), tablet and desktop, never desktop alone. Fill a slot one of two ways: a background plate larger than every ratio with the foreground (logo, characters) placed per ratio inside a marked safe area, or one image generated at each exact ratio. Never crop through the subject, stretch, or add bars. Post review rounds phone portrait first, each composite at its real display size, and record the ratios and anchors in the recipe so the app can serve the right one. A round with only a wide desktop image is not ready to post.

A creator judges a look fastest from a picture of the game screen. Before building dioramas or wiring real assets,
show **image mocks**: generated stills of the actual play screen, steered by the kit (asset set) the game uses. Real
assets come in step 2, built toward the mock the creator picked.

## When

- Always first for a new game's look, a restyle, a new screen, and character or aesthetic options.
- Skip only when the creator asks to see the real assets directly, or the change is too small to need a picture.

## Make the options

1. **Read the direction, then pick the real assets.** The creator's concept art, logo, spec and feedback ledger set the
   mood; the kit's set card gives the game's genre and camera. Pick the pack assets this scene uses first
   (`gm assets search`: buildings, props, tiles, the high-res class sprites for characters) and attach them to every
   generation. Logo-derived screens (title, loading, end screen, thumbnail) follow the logo: its viewpoint (a
   first-person door, never an isometric background behind it), its rocks, and the logo attached as a reference.
   Write the direction into each prompt in plain words.
2. **Four options that differ greatly.** Different environment, palette, board or play-area treatment, HUD shape, and
   character staging. Never four tints of one scene.
3. **The player's screen, nothing else.** Each mock is one in-game frame as the player sees it, from the game's real
   camera: playfield, HUD (score, next, timers), characters, effects at a key moment (a clear, a hit, a win). No
   off-camera, wide, orbit or debug views. Phone portrait first, then phone landscape, tablet and desktop (the aspect set above).
4. **Rosters are voted item by item.** For characters (or any set the game ships several of), first ask how many
   the game starts with, then offer **twice that many** individual options, each its own card with a name and a
   one-line personality. Push each past the kit's default look (colours, props, expression, pose) so no two read as
   the same character. Never offer pre-bundled collections as the choice.
5. **Supporting pics** when the review needs them: character select, aesthetic choices (block sets, frames, palettes),
   a menu. Same rules.
6. **Respect the creator's feedback.** Read the game's feedback ledger (`design/feedback.json`) when it exists; never
   show an option that breaks a rule there or repeats one the creator rejected.

## A target clip

When the creator wants the game to look like a video, the creator supplies the clip; never generate, download or
ask a model for one. The vendored video-to-game tools read it locally with ffmpeg:

1. **Study it.** `python3 .claude/skills/vendor/video-to-game/scripts/study_video.py <clip> -o study/` writes frames,
   `sheet.jpg`, a palette and the cuts. Follow `.claude/skills/vendor/video-to-game/references/study-the-video.md`:
   look at every frame and write the camera, hero, palette and light from named frames into each mock prompt.
2. **Compare a build with it.** Shoot the same three spots each pass, run
   `python3 .claude/skills/vendor/video-to-game/scripts/side_by_side.py <clip> <shot.png> -o pairs/ --times <s>`,
   look at each pair and fix one difference at a time
   (`.claude/skills/vendor/video-to-game/references/look-and-post.md`).
   `python3 .claude/skills/vendor/video-to-game/scripts/best_window.py <take.mp4> --length 3` finds the liveliest
   seconds of a recorded take.

No fal and no provider key: never add or ask for one. Upstream's fal generation is not vendored; pictures come from
the packs, gm-asset-variants and the generation routes below.

## Generate

Never call a built-in image tool (`image_gen`, `imagegen`): it bypasses the reference check and is off for workers.
Always run `python3 <this skill>/scripts/request-mock.py --prompt-file <file> --out <dir> --ref <workspace path>...
[--aspect 9:16]`. The broker refuses an image without 2+ refs under `assets-local/packs/` or `assets-local/sets/` (or
the game logo from `assets-local/review/<slug>/` for a logo-derived screen) and says why.
The host's mock broker writes the image into `<dir>`; the script waits and prints the paths. You never hold a provider
key. Mark outputs as AI-generated. Keep each prompt self-contained: the screen, the moment, the palette, the HUD.

**Two lanes, set by the ticket's label** (creator, 2026-11-20: "mocks do a MUCH better job with creativity, creating
beautiful and aspirational directions"; the sprite pipeline needs "direct clone of existing style"):
- **`lane:creative`** (towns, settings and biomes, UI screens, HUD, menus, title, loading and end screens, logos,
  thumbnails): image generation for composition, lighting, layout and beauty, built from the game's real pack assets
  for that scene attached directly, in the game's graphics style and camera (isometric for Dusk Helm scenes), so the
  prototype rung can rebuild it from those assets (creator, 2026-11-21: "mocks should match the graphics style and
  isometric angle so they can be useful for copying in prototype phase with real engine assets"). Characters are the
  high-res class sprites. No lineups, in-engine renders or empty fields stand in for a mock, and a round never posts
  with an option lacking media.
- **`lane:clone`** (rebuilding or varying a pack's sprites): no imagination. Load `gm-sprite-forge`, attach the
  originals to every generation, match their pixel density, outline, shading and camera exactly, and pass its gates.
  A clone that is "better" than the original is off-style.

Budget: one image per option per view, then regenerate only the ones that came out wrong. Look at every image before
sending it (gm-verify). If your tools cannot show you an image (a shell-only agent), ask a vision model:
`request-mock.py --kind look --ref <shot> --ref <target> --prompt-file <questions>` writes its plain answers to
`<out>/<name>-<id>.look.md`, ending in `VERDICT: pass` or `VERDICT: fail` (`gm look check` gates the PR on it); ask about every rule in the feedback ledger and every difference from the target: wrong genre, unreadable HUD, extra limbs or off-kit style means regenerate or drop it.

## Before a mock becomes a build target

A painted mock can promise what the engine cannot draw. Before the picked mock becomes a ticket's target:
1. **Prefer restyled real renders** (the render-restyle tool) as targets; a pure prompt mock is direction, not spec.
2. **Feasibility list:** map every element (camera and staging, board, pieces, background, HUD, characters) to a kit
   card id or an engine feature, and mark what needs code (procedural geometry, a material) or an engine change. Gaps go
   to the creator as a question with options, never silently swapped for primitives.
3. **Evidence matches the mock's moment:** the same mode, board size and situation (a chain mid-clear), from the same
   camera.
4. **The look check gates the push:** any `VERDICT: fail` or unanswered question on changed stills or explicitly selected screens means no PR; a
   broker error (such as 402) is a blocker to report, not a pass.

## Show

Raise one `decision.requested` Command with `blocking: false` only once every option has media: the mocks in `media[]` (option ids A to D), recommendation first, each option described as what the player sees
in one line. The creator answers per option (like or dislike, a note each) and with notes on the whole set; apply both.
Label them as mock-ups. Build and ship the recommendation while the pick is pending; silence is a provisional default, never approval. Record the pick in the decision log; the pick is the visual target for the diorama and build
work that follows. A mock answers how the game looks; how it feels (speed, chain pause, controls) is never a still or a
link: offer playable options instead (`gm decide --playable <id>=<scenario query>`), which the review deck plays one
after another in the card.

## Voice samples

Same rule for audio: sample before you mint. `request-mock.py --kind voices --out <dir>` lists the voices;
`--kind voice --voice-id <id> --prompt-file <line.txt> --out <dir>` makes one short sample (one line, under 300
characters). Offer six voices per character choice, each speaking the same two lines in character, and let the
creator like or dislike them in the review deck before generating any full set. Voices must be expressive, never
monotone: use `--voice-model eleven_v3 --stability 0.0` with emotion tags in the line (`[excited] Nice one!`,
`[laughs]`, `[shouting]`) and pick character or animation voices.
