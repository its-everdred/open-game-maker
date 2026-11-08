---
name: gm-verify
description: Use before showing a creator any visual game change. Run deterministic gates, look at the evidence, and report the binary checklist.
---

# Verify a game

Never report a visual result you have not looked at. Code, logs, and a passing command are not visual evidence.

## Gates first

1. Run `gm check`; fix every L0 failure.
2. Run `gm test --ticks 3600`; fix every L1 failure.
3. Fix the first new console error before investigating anything after it.
4. Run `gm options check` on any option set before it reaches the creator; a rejection in `design/feedback.json` blocks it.
5. Only then run `gm run --frames 0,2,5` (the host frame's top bar, Pause and touch overlay, at 390x844, 844x390,
   820x1180 and 1180x820; `--viewport all` adds desktop) and make the sheet with `gm shot --sheet shots/`.
6. After your last `gm run` and commit, look at each still:
   `python3 .claude/skills/gm-image-mock/scripts/request-mock.py --kind look --out looks --ref <still> --ref <target> --prompt-file <questions>`.
   Then, before opening or updating the PR, run `gm look check`: every committed still (or, when none is committed,
   every rendered `tN.png`) needs a passing answer for its current bytes. If it says `blocked`, the look broker failed
   (a 402, say): report the work as blocked, never as a pass.
7. Each screen with an approved render in `review/decisions.json` needs `gm look sheet <screen> --still <png>` (the
   still beside its target), looked at like a still; `gm look check` fails on a missing sheet or a mismatch.
8. Commit every file the PR links under `review/<ticket>/`; `gm look evidence --body <pr-body.md>` fails otherwise.

A report budget whose status is `over` blocks the PR. Name the tier and the measured value. `unknown` is not green:
list it under unchecked.

## Look

- Capture the touch phone and tablet stills, both orientations. Read every tile and name the worst defect first.
- Use a timeline for motion; a follow camera is drawn twice so its lag can settle.
- Use `--inputs` and closer `--frames` around small events instead of judging them from a wide shot.
- Check the title, main play state, first action, HUD, and any changed scene or screen.
- Treat the sheet as the source of truth. Do not infer appearance from scene objects or source code.

## Judge a set as a set

A set of assets is judged whole: one beautiful item beside an off-style one is a failed set. Score cohesion, reference
fidelity, brief, mesh quality, texture quality, assembly (parts seated and connected, nothing hovering), scale (real
size alone and relative to the others), and labels, most damaging problem first. Pass only with no category below 6 and
an average of 7 or more; name at most five fixes. Put proportion in front of you with a to-scale lineup and a scale bar
side by side, not a grid of thumbnails at unrelated scales. `python3 -I scripts/assets/set_critic.py` holds the bar,
the fixes cap, the round cap and the deliverable gate; the rubric and the reason for each are in
`docs/research/anykit-lessons-2026-11.md`.

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

Visual findings advise; `gm check`, `gm test`, console errors, and budgets block.

## Rules

- Bind local servers to `127.0.0.1`, never `0.0.0.0`.
- GPU Chromium is the default. Use SwiftShader only when the environment requires it and record that fact.
- After every `gm run`, send exactly one current still or clip with `gm chat post`.
- Never install software or add a paid visual judge to verify a game.
- Always list `iPhone Safari` and `sound` as unchecked unless an operator actually checked them.

**Seeing your own output.** Numeric checks (luminance, colour counts, magenta) never prove a frame looks right. If
you cannot view images yourself, run the `gm-image-mock` look request on each still beside its target mock and put
its answers in the evidence; fix every defect it names and look again until it answers `VERDICT: pass`.
