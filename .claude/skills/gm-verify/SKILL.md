---
name: gm-verify
description: Use before showing the creator anything visual: a scene, a screen, a game change. Check by looking (stills at desktop and phone sizes, a timeline of the motion, close-ups of small events), then deliver clips the creator can play on a phone. Also for "record a video", "send screenshots", "does it look right".
---

# gm-verify

Never report a visual result you haven't looked at. Reading code or logs is not looking.

## Look

- Headless Chromium on the GPU: `--use-angle=gl-egl --enable-gpu --ignore-gpu-blocklist` (SwiftShader is the slow
  default). Serve the prototype over HTTP; `file://` breaks module imports.
- Stills: 1440x900 and 390x844 (phone, `deviceScaleFactor: 2`, `isMobile`). Check the title, the main screen and the
  first click.
- Motion: pages expose a capture mode (`?capture`, `window.__frame(t)`) so any time can be drawn exactly.
  The archived town-only helper at `apps/web/title-town/tools/capture.mjs stills|timeline|record "<query>" <out> ...` draws stills, one tiled
  timeline in time order, or a phone-ready MP4. A scene camera that follows scene state lags one frame in stills
  taken out of order; judge camera work from a timeline or the recording. (Tiling by hand? sort with `sort -V`; plain `sort` puts t10 before t4.)
- Small events (a building rebuilt, a monster's punch): add a debug camera that frames the event (`?focus=` /
  `?cam=scene`) instead of judging from the wide shot. Look at destruction in 2x-resolution crops of the phone view
  too: the creator pinches to zoom, and stretched debris (long slivers from a scaled model) hid at 1x.
- Tap targets (the Easter egg): `apps/web/title-town/tools/taptest.mjs <out> <t>` scans which screen points count as
  a hit and taps the extremes; a tap well off the enemy must not count, and the effect must land where the finger was.
- Something that blinks in and out with nothing toggling it: try `frustumCulled = false` first (cloned skinned meshes
  keep stale bounds and get culled).
- Waiting on a background render: `pgrep -f "<pattern>"` also matches the waiting shell's own command line, so it never
  ends; wait on the PID or a done file.
- Read each tiled image and say what is wrong before fixing; fix the worst thing first. Something blocking the shot
  may not be in the scene's object lists (props placed directly, like a market hall): find it before moving the camera.
- When the creator gave a reference image, put it beside your render in one image and compare before showing
  anything (shape, view angle, palette); record clips only once that pair matches.

## Judge a set of assets

When the thing to look at is a set (a pack, variants, a showcase), judge it whole: one good item beside an off-style
one is a failed set. Score cohesion, reference fidelity, brief, mesh quality, texture quality, assembly, scale and
labels, pass only with no category below 6 and an average of 7 or more, and name at most five fixes, worst first. A
thumbnail grid is not scale: put the set in a to-scale lineup with a scale bar beside the render. The bar, the caps and
the deliverable gate are `python3 -I scripts/assets/set_critic.py`; detail is in `docs/research/anykit-lessons-2026-11.md`.

## Deliver

- Each ready post names the skills used and links the score JSON when available; record each posted file with `python3 scripts/meta/skill-usage/artifacts.py --repo <repo> --ticket <number> --commit <sha> --post-id <comment-id> [--turn-id <turn-id>] --skill <skill> [--target <file>] [--score <json>] <file>`, then run `scripts/meta/skill-usage/collect.sh`.

- `apps/web/title-town/tools/capture.mjs record` encodes H.264 `yuv420p`, 960 px wide, CRF 27, `+faststart` (a 2-minute clip is about 5-10 MB).
  The Claude mobile app does not play WebM.
- Publish an artifact page: `apps/web/title-town/tools/clips_page.py <dir> "title" "intro" clip.mp4="Heading|one line" ...` builds it with
  poster frames; files over the per-call limit get re-encoded smaller, not dropped.
- Sound: `apps/web/title-town/tools/mix_sound.mjs` lays a scene's cues under a recording; check the balance with an
  ffmpeg `showwavespic` image (a loud loop flattens every hit), and say it wasn't listened to.
- A live JS page with many modules (over 256 files per publish): bundle it into one inline script with esbuild
  (`npm i esbuild` in the scratchpad, `--bundle --format=esm --minify`).
- Before deploying anything a phone loads, time it: `apps/web/title-town/tools/loadtime.mjs <url>` (iPhone profile,
  CPU 4x slower, then a cached reload), with nothing else rendering (a recording in the background tripled one result). Seconds of setup on a phone are usually work that never changes: bake it at build
  time (see `apps/web/title-town/tools/bake.mjs`); find it with a CPU profile (CDP `Profiler`) before guessing (one hot `height()` was 10 s).
- Then record the first visit and reload and look at every other frame (black frames, a pop between poster and live, a stale build). After deploying, also load
  the live site in a browser that had the old build: cached files must never mix old code with new data.
- Say what was checked and what wasn't (for example "not checked on iPhone Safari").

## Playable previews

Run `gm preview --ticket <number>` from the game workspace to upload a review build. New worker workspaces receive a ticket-scoped upload credential from the daemon hook; recreate workspaces made before the hook was updated to provision it; removing the workspace or rotating the daemon secret revokes it. It grants preview uploads only for that ticket and game. Never copy the credential into commits or build output. If an upload times out after an API restart, rerun `gm preview` to submit a fresh request.
