---
name: gm-verify
description: Use before showing a creator any visual game change. Run deterministic gates, look at the evidence, and report the binary checklist.
---

# Verify a game

Never report a visual result you have not looked at. Code, logs, and a passing command are not visual evidence. For a custom rigged machine, see `vendor/anymachine/SKILL.md` for overlap sweeps and GLB re-import checks.

## Gates first

1. Run `gm check`; fix every L0 failure. After building, run `gm check boot --dist dist` before marking the game ready; fix a blank frame or missing readiness at either viewport.
2. Build a separate test-mode build with `pnpm exec vite build --mode test --outDir .gm-test-dist`, then run `gm test --serve .gm-test-dist --ticks 3600`; fix every L1 failure. Keep the published `dist` intact for the boot check. `gm test` exits on its own; never wrap it in a wait; on a stall exit, read the diagnostic.
3. Fix the first new console error before investigating anything after it.
4. Run `gm options check` on any option set before it reaches the creator; a rejection in `design/feedback.json` blocks it.
5. Commit tracked visual changes, then run `gm run --verify-source --frames 0,2,5` (host frame's top bar, Pause and touch overlay at 390x844, 844x390, 820x1180 and 1180x820; `--viewport all` adds desktop) and make the sheet with `gm shot --sheet shots/`.
6. After your last `gm run`, look at every still you added:
   `python3 .claude/skills/gm-image-mock/scripts/request-mock.py --kind look --out looks --ref <still> --ref <target> --prompt-file <questions>`.
   Make each ticket screen's comparison with `gm look sheet <screen> --still <png>` and look at the sheet. After committing any tracked captured stills, run `gm look scope add <screen> --still <png>` for each ticket screen (repeat `--still` for its looked-at stills), commit `design/look-scope.json`, then run `gm look check --changed` plus `gm look score`/`gm look judge` on those screens. Inherited gaps do not block. If the look broker fails, report the gate as blocked, never as a pass.
7. Commit every file the PR links under `review/<ticket>/`; `gm look evidence --body <pr-body.md>` fails otherwise.
8. Run `gm qa playtest <game> --all-modes` after building: a seeded bot plays every mode at the four touch sizes and writes stills, a clip per mode and `playtest.json` to `<game>/shots/playtest/` (`--json` for the verdict). Declare every playable mode in `gm.manifest.json`, e.g. `"modes": [{"id": "both", "label": "Both", "tap": "Play>Endless>Both>Play"}]` (`tap` is the exact on-screen text, `>`-separated). Implement `qa: { invariants: () => [{ name: 'one piece per cell', ok, detail }] }` on the mounted instance, one entry per state rule. It fails on a false invariant, more or fewer than one `data-gm-play-area` board, UI over the board, game console errors, and text a long press selects (put `user-select:none` and `-webkit-touch-callout:none` on `html, body`). On a fail, fix the worst line, rebuild and rerun; never post a failing run. Report each `unchecked:` line (no modes, no invariants) as unchecked, not as a pass. Look at every mode's stills and clip. It is required at each rung checkpoint from prototype on, and in game CI.
9. Any scene with a map (a town, yard, village, biome, building): run `gm verify scene <game> <scene>` (a bare name reads `maps/<scene>.json`; add `--under <map.json>@dx,dy` for a surround drawn beneath, `--zoom` and `--center x,y` for the game's camera, `--mock <png>` for the approved mock, plus `--mock-character <px> --character-height <px>` to compare character size, `--overlay <png>` to draw each finding on the map, numbered by rank; open it). It checks connected fence and wall runs, closed buildings with roof and door, overlap, facing, routes from the spawn and natural dressing. Fix from the top of its ranked list; `--json` or `--out <base>` gives the same list as data. Exit 1 means a failing high finding (the report is still printed); exit 2 is bad usage. A failing high finding blocks the review; one you cannot fix this round goes in `--allow <finding id>` (repeatable; prefer the finding id from the report, since a check name such as `connected-runs` waives that whole check) and in the review's known limitations. `facts/unmeasured-edge` (high) means those runs went unchecked: list it as unchecked, never as a pass.

A report budget whose status is `over` blocks the PR. Name the tier and measured value. List `unknown` under unchecked.

## Look

- To inspect a local build in the real signed-in app with player input, use `gm qa drive --app https://<app>/play/<slug> --journey <journey.json> --viewport phone`; see `gm-qa` for session setup, results and limitations.
- For every layout change, mark the board element with `data-gm-play-area` and run `gm look shell` at all four viewports. Read its board fill and horizontal offset numbers; the default gate requires at least 0.90 fill and at most 0.05 offset. For a fixed-aspect board set `data-gm-play-area-aspect` to width divided by height; fill must then reach 90% of the largest rectangle of that aspect that fits. `gm check` builds and captures a fresh verification `dist`, then restores the previous `dist`; the package build script must invoke the game builder directly, not `gm build`. Prepare generated assets with the game's own asset-build settings first. Set `playArea.tap` in `gm.manifest.json` to the `>`-separated actions that enter play; optional `playArea.minFill` and `playArea.maxOffset` override the defaults. Declare reserved vertical control bands in CSS pixels on the board as `data-gm-control-top` and `data-gm-control-bottom` (safe-area insets are measured separately). Each captured screen reports the board separately: a clipped board or visible UI overlapping it fails before fill is reported. Mark intentional DOM overlays with `data-gm-overlay-allowed`; canvas UI can report its bounds through the SDK `reportUiSprites` API. `gm look shell` skips inactive title, menu, or editor screens when another screen in that viewport has an active board. The final tapped gameplay screen (or play screen when no taps are configured) must have an active board; otherwise `gm check` fails the gate. Games without a play area may set `playArea: false` to skip the board measurement, or `playArea: { "disabled": true, "tap": "Play>Start" }` to skip it while still capturing a journey; the image distortion gate still runs.
- Capture the touch phone and tablet stills, both orientations. Read every tile, name the worst defect first, and fix image distortion reported by `gm look shell` or `gm check` at every viewport.
- Motion: a timeline (a follow camera is drawn twice to settle its lag); small events: `--inputs`, closer `--frames`.
- A target to match? A failed look is the next round's to-do list: work in rounds with `close-the-gap.md` here.
- Check the title, main play state, first action, HUD, and any changed scene or screen.
- Treat the sheet as the source of truth. Do not infer appearance from scene objects or source code.
- A model looks black, flat, or wrong? Open `.claude/skills/vendor/gamedev/threejs-materials-lighting/SKILL.md`.
- Judge asset sets together; follow the set rubric in `close-the-gap.md`.

## Matching concept art

On every iteration, capture a settled view with the same camera and size. Measure the concept directly: express sizes and positions as fractions of a cell. Run `gm look score <target.png> <candidate.png>` and
`gm look judge <sheet.png> --rubric tiers`. Fix the highest-ranked differences and repeat. Stop when all tiers pass
at 8 or more. If three iterations fail to beat the best score so far by at least the larger of 0.5 and the reported tier spread, change technique (a different renderer,
library or layout, not another layer or parameter on the same one); if that stalls too, return to the best checkpoint
and raise one Command with the scored sheet (Blobs #309 ran 40 trials at 4.2-5.4 and #310 58 at SSIM 0.12, 2026-11-11). Choosing the next technique is yours: if you can name a recommended option, take it and note it in the workpad (#310 raised five blocking Commands in 90 minutes, each with a sound recommendation, 2026-11-12). After judging, rerun `gm look score` to include the cached default-run `judge_spread` in its JSON; it is null until that judgment exists. The spread is the largest absolute deviation from each tier median among the sampled runs, not a guarantee for a new image. Ready posts include the score JSON and side-by-side. Do not ask the Executor or
creator to judge differences the scorer can judge. Follow the look broker's consent and licence restrictions.

## Binary visual checklist

Copy this into the PR and answer every line from the sheet:

```md
## Verify

- Blank frame? yes/no
- Missing texture or magenta surface? yes/no
- Clipping, z-fighting, or floating object? yes/no
- Text cut off or unreadable? yes/no
- HUD overlaps play on phone? yes/no
- Placeholder primitive or debug gizmo visible? yes/no
- Entity stuck, teleporting, or ice-skating? yes/no
- Animation and movement speed disagree? yes/no
- Worst visible defect: <one sentence>
- Evidence sheet: <committed path under review/<ticket>/>
- Unchecked: iPhone Safari, sound, <anything else not run>
```

The scoped visual gate, `gm check`, `gm test`, console errors, and budgets block. A playable build that changes what the creator can do or see is not delivered until its prototype review is raised and copied into the PR body (`../gm-core/references/decision-inventory.md`): play link with its scenario, a phone-playable MP4 from this run, works now, known limitations and 3–6 inventory decisions to weigh in on. Check every works and limitation line in the build you captured, and list what a player hits in the first minute (no attack, no walk animation, no setting).

Run `gm look score` and `gm look judge` on your changed screens against their targets. Fix failures; inherited gaps do not block. Experiment tickets also post captures on the issue.

## Rules

- Bind local servers to `127.0.0.1`, never `0.0.0.0`.
- GPU Chromium is the default. Use SwiftShader only when the environment requires it and record that fact.
- Wait up to 10 minutes for a capture slot. If a capture process stays at 0% CPU for 10 minutes, kill it by PID and retry once. If GPU startup stalls, rerun with `GM_VERIFY_SOFTWARE_GL=1` and record the fallback.
- For app-shell touch stills without a QA account, use `gm look shell --dist <game/dist> --out <directory>`; use `--scenario <name>` to start in the slice under review (the same entry its review card plays; prefer it to a long `--tap` journey), `--tap 'Play>Endless'` for successive game actions, `--edit` for the editor, and `--mp4` for motion. The shell mocks sign-in and game APIs: report it as local, not production or Safari.
- Exit 3 means the total timeout expired. Stderr identifies the capture stage and viewport; the command publishes stills only after every requested view succeeds. A missing or inaccessible Chromium executable is reported by Playwright; it must be installed and executable in the worker sandbox. A missing `index.html` or `design/design.json` means the game needs a build first. Browser and game-resource errors appear on stderr. If the system temporary directory is unavailable, scratch files use the workspace and capture slots are shared within that workspace (`.gm-verify-runtime`).
- After every `gm run`, send exactly one current still or clip with `gm chat post`.
- Never install software or add a paid visual judge to verify a game. Always list `iPhone Safari` and `sound` as unchecked unless an operator actually checked them.

**Seeing your own output.** Numeric checks (luminance, colour counts, magenta) never prove a frame looks right. If you cannot view images yourself, run the `gm-image-mock` look request on each still beside its target mock and put its answers in the evidence; fix every defect it names and look again until it answers `VERDICT: pass`.
