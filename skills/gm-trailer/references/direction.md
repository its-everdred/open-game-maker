# Trailer direction

## Why trailers come out flat

- **Snippets instead of shots.** Each `gm trailer` scenario starts a fresh game and runs for seconds, so the cut is a
  handful of long, calm openings. Blobs round 3 had four shots averaging 3.5 s and a "left out" list longer than its
  shot list.
- **The easy footage, not the game.** Shots were picked by which scenarios existed. Start from the inventory and
  build the entry points the shots need.
- **No arc.** Nothing hooks the first two seconds, nothing builds, and the trailer ends wherever the footage ran out.
- **Cuts that ignore the music.** Per-snippet game audio joins with a jump at every cut; there is no beat to cut on.
- **A locked-off camera.** The whole screen at fit size for every shot, so a small sprite's best moment reads as
  nothing at phone size.
- **No look before posting.** The format gate passes a trailer with frozen stretches, repeats and missing modes.

## The arc (25–30 s)

| Part | Share | Shots | Shot length | Music |
|---|---|---|---|---|
| Hook | first 1.5–3 s | 1–2 | short, already moving | the action track's pickup, or a sting |
| World | ~30% | one per location, in play order | 2–4 beats | the game's calmer theme |
| Action | ~40% | each encounter type and several abilities, escalating | 1–2 beats | battle theme |
| Climax | ~15% | bosses, the biggest effects | 2–3 beats, punch-ins | boss theme |
| Button | last 1–2 s | the single best hit or reveal | 2–4 beats, ends on the impact | the phrase's last downbeat |

Change the music between parts on a cut. A track change is itself a beat: let the first shot under the new track
land on its downbeat.

## Shot rules

- One idea per shot, already in motion on its first frame (trim the walk-up, the menu cursor and the fade-in).
- Never two shots of the same location or move in a row; alternate wide (a whole room, the arena) with close
  (the hero, a hit) so cuts read even when colours are similar.
- Action shots start just before the impact and end just after it. A dialogue box is allowed only when its line is
  the joke or the stakes, and only for as long as it takes to read.
- Show variety the inventory demands, even when it needs new entry points: a debug scene jump, a save, a seeded
  scenario. Getting there through real input is part of the capture, not of the cut.

## Capture

- Real build, real input. Prefer the game's own scenario or save entry so each take starts where the shot does,
  then drive it with key holds and taps (or touch). No mocked frames, no edited sprites.
- Determinism beats speed on a loaded host: replace the animation clock so each captured frame advances the game
  exactly one frame, and log every sound the game plays with that virtual time (`scripts/capture.mjs` does both).
  Playwright's own fake clock and element screenshots wait for real animation frames and stall or crash under a
  replaced clock; read the canvas with toDataURL in the same evaluate that drew it (JPEG is several times faster
  than PNG at 1280 wide). Use `--gpu` when the host has one: software WebGL ran 2-20 s a frame at load 60.
- Load the page once and enter each take from the game's own state (save, scene, scenario) instead of reloading;
  a heavy game can take minutes to boot on a busy host.
- Capture at the game's native resolution or an exact multiple of it; record 2–3× the footage the cut needs.
- Render the game's music and effects offline when they are synthesized (an OfflineAudioContext driven by the
  same scheduler) so a busy host cannot glitch them.

## Framing

- Every crop is the output aspect (16:9) and is scaled uniformly. For pixel art use nearest-neighbour and prefer
  whole multiples of the native pixel (a 320×180 window of a 320×240 game is exactly 4× at 1280×720).
- A 4:3 game fills the 16:9 frame by choosing which 180 rows of 240 to show per shot; pan across the slack for
  movement, and punch in (a tighter crop on a cut) on hits. Never letterbox, pillarbox or stretch.
- Crop HUD or menus out when the action reads without them; keep them when the number or the choice is the point.

## Sound

- One music bed from the game's own tracks, cut on beats (`assemble.py` does it), with 15 ms edges at the joins.
- The game's own effects layered at the frames they happened, a little under the music on world shots and on top
  in action. A hit with no sound reads as a glitch.

## Self-check and look

`selfcheck.py` fails a cut with too few shots, a shot over 4 s, an average over 2.5 s, an inventory item never
shown, action under 35% of the runtime, an opening that is not the hook, a cut the scene detector cannot see, or a
frozen (0.8 s) or black stretch. Then look: the contact sheet has one still per shot in order; read it and at least
one frame every two seconds of the video, and watch it through with sound. Every location and every battle in the
inventory must be visible in those stills.
