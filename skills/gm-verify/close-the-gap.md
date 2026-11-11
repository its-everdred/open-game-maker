# Close the gap to a target

Use when a creator's target image (an approved render, a mock, a picture the creator made) must be matched by the real game.

A failed look is the next round's to-do list, not a verdict. Each round: the sheet beside the target, the differences
worst first, and for each what would close it (camera, light, material, layout, a kit piece, a shader); fix the top one
to three, then a new sheet. Keep each round's sheet in `review/<ticket>/rounds/` so the creator sees it move closer.
A difference that needs something outside the ticket (a missing kit piece, an engine feature) gets its own ticket with
the sheet, and the rest keeps closing. Never stop at "fail", and never accept a difference for the creator.

- Shoot the real game, not a mock: a real run in the app shell, in the mode the target shows (a target with a second
  board is a versus run), at a phone and a tablet size. One sheet per size: target, previous round, this round.
- Ship each clear improvement on its own (PR, merge, publish), then shoot the published build, not the PR's, and send
  the creator that sheet. Small shipped steps beat one big reveal: the creator can redirect after each.
- Before adding a kit piece, check the build's asset budget: reuse, retint or rescale the pieces already in the bundle
  first (one pine reused at three depths and three shades read as a forest; a new pine broke the 2 MB mobile tier).
- A near-level camera puts background depth on the screen's vertical axis: a prop's base shows at the height of its
  distance behind the subject, so a backdrop that should rise behind something stands between its foot and its top.

## Judge a set as a set

A set of assets is judged whole: one beautiful item beside an off-style one is a failed set. Score cohesion, reference
fidelity, brief, mesh quality, texture quality, assembly (parts seated and connected, nothing hovering), scale (real
size alone and relative to the others), and labels, most damaging problem first. Pass only with no category below 6 and
an average of 7 or more; name at most five fixes. Put proportion in front of you with a to-scale lineup and a scale bar
side by side, not a grid of thumbnails at unrelated scales. `python3 -I scripts/assets/set_critic.py` holds the bar,
the fixes cap, the round cap and the deliverable gate; the rubric and the reason for each are in
`docs/research/anykit-lessons-2026-11.md`.
