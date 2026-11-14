---
name: gm-verify
description: Use before showing a creator any visual game change. Run deterministic gates, look at the evidence, and report the binary checklist.
---

# Verify a game

Never report a visual result you have not looked at. Code, logs, and a passing command are not visual evidence.

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

A report budget whose status is `over` blocks the PR. Name the tier and measured value. List `unknown` under unchecked.

## Look

- Capture the touch phone and tablet stills, both orientations. Read every tile and name the worst defect first.
- Motion: a timeline (a follow camera is drawn twice to settle its lag); small events: `--inputs`, closer `--frames`.
- A target to match? A failed look is the next round's to-do list: work in rounds with `close-the-gap.md` here.
- Check the title, main play state, first action, HUD, and any changed scene or screen.
- Treat the sheet as the source of truth. Do not infer appearance from scene objects or source code.
- A model looks black, flat, or wrong? Open `.claude/skills/vendor/gamedev/threejs-materials-lighting/SKILL.md`.
- Judge asset sets together; follow the set rubric in `close-the-gap.md`.

## Matching concept art

On every iteration, capture a settled view with the same camera and size. Measure the concept directly: express sizes
and positions as fractions of a cell. Run `gm look score <target.png> <candidate.png>` and
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

The scoped visual gate, `gm check`, `gm test`, console errors, and budgets block.

Run `gm look score` and `gm look judge` on your changed screens against their targets. Fix failures; inherited gaps do not block. Experiment tickets also post captures on the issue.

## Rules

- Bind local servers to `127.0.0.1`, never `0.0.0.0`.
- GPU Chromium is the default. Use SwiftShader only when the environment requires it and record that fact.
- Wait up to 10 minutes for a capture slot. If a capture process stays at 0% CPU for 10 minutes, kill it by PID and retry once. If GPU startup stalls, rerun with `GM_VERIFY_SOFTWARE_GL=1` and record the fallback.
- For app-shell touch stills without a QA account, use `gm look shell --dist <game/dist> --out <directory>`; use `--tap 'Play>Endless'` for successive game actions, `--edit` for the editor, and `--mp4` for motion. The shell mocks sign-in and game APIs: report it as local, not production or Safari.
- Exit 3 means the total timeout expired. Stderr identifies the capture stage and viewport; the command publishes stills only after every requested view succeeds. A missing or inaccessible Chromium executable is reported by Playwright; it must be installed and executable in the worker sandbox. A missing `index.html` or `design/design.json` means the game needs a build first. Browser and game-resource errors appear on stderr. If the system temporary directory is unavailable, scratch files use the workspace and capture slots are shared within that workspace (`.gm-verify-runtime`).
- After every `gm run`, send exactly one current still or clip with `gm chat post`.
- Never install software or add a paid visual judge to verify a game.
- Always list `iPhone Safari` and `sound` as unchecked unless an operator actually checked them.

**Seeing your own output.** Numeric checks (luminance, colour counts, magenta) never prove a frame looks right. If
you cannot view images yourself, run the `gm-image-mock` look request on each still beside its target mock and put
its answers in the evidence; fix every defect it names and look again until it answers `VERDICT: pass`.
