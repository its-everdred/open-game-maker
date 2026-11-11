---
name: gm-image-mock
description: Load at the start of any visual design review (a new game's look, a restyle, a screen, character or aesthetic options). Step 1 of game design prototyping: generate pure image mock-ups of exactly what the player will see, informed by the chosen kit, and show them as options before any real-asset diorama or build work.
---

# Image mocks: review step 1

A creator judges a look fastest from a picture of the game screen. Before building dioramas or wiring real assets,
show **image mocks**: generated stills of the actual play screen, steered by the kit (asset set) the game uses. Real
assets come in step 2, built toward the mock the creator picked.

## When

- Always first for a new game's look, a restyle, a new screen, and character or aesthetic options.
- Skip only when the creator asks to see the real assets directly, or the change is too small to need a picture.

## Make the options

1. **Read the kit.** Search the set (`gm assets search`) and read its set card and lineups: shape language, bevels,
   proportions, palette, how characters look. Write what you saw into each prompt in plain words. The mock must look
   like it could be built from that kit.
2. **Four options that differ greatly.** Different environment, palette, board or play-area treatment, HUD shape, and
   character staging. Never four tints of one scene.
3. **The player's screen, nothing else.** Each mock is one in-game frame as the player sees it, from the game's real
   camera: playfield, HUD (score, next, timers), characters, effects at a key moment (a clear, a hit, a win). No
   off-camera, wide, orbit or debug views. Phone portrait first when the game targets phones, then desktop.
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
the packs, gm-asset-variants and the mock broker below.

## Generate

Run `python3 <this skill>/scripts/request-mock.py --prompt-file <file> --out <dir> [--ref <workspace path>]... [--aspect 9:16]`.
The host's mock broker generates the image and writes it into `<dir>`; the script waits and prints the paths. You never
hold a provider key. References must be workspace files from free-licence packs (the broker refuses anything else; no
paid pack ever leaves the host). Keep each prompt self-contained: the kit description, the screen, the moment, the
palette, the HUD.

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

Raise one `decision.requested` Command with `blocking: true` (until aiur #7872 is deployed, a non-blocking one expires
unseen): the mocks in `media[]` (option ids A to D), recommendation first, each option described as what the player sees
in one line. The creator answers per option (like or dislike, a note each) and with notes on the whole set; apply both.
Label them as mock-ups. Record the pick in the decision log; the pick is the visual target for the diorama and build
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
