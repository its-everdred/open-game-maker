# Churchyard proof: first comparison

The target is the approved Overgrown churchyard image from open-games #24, SHA-256
`dfe017dea24bd823225371d4c0f38cefcba757797c4fb8d8b41814d92868ba95` (941 × 1672). The
comparison capture is the checked-in 390 × 844 fence-round image at game commit
`47e9544ee34c08d964418681435ad0c3a5b07a0b`, SHA-256
`c65662417ce3169a35e7b366b4bba0a64a11766ce36227e9bef2d0ab2d083ffe`.
The private side-by-side is `assets-local/review/1154/churchyard-unregistered.png`.
The camera centre, scale, and visible area differ; this is a visual comparison,
not a registered image score or an in-engine recapture at the target framing.

## Ranked discrepancies

1. **Framing and scale:** the mock fills the phone with the yard and a prominent
   knight; the capture shows the map edge and a large empty area, and its actors
   are much smaller. Match the camera and character height before pixel metrics.
2. **Chapel:** the mock has a roofed, closed stone building with a central door,
   steps, cross and side windows; the capture has a freestanding wall and arch.
   The game map itself calls the facade provisional. A suitable multi-piece
   assembly has not been verified; do not call a single high-scoring sprite a
   complete chapel.
3. **Approach:** the mock has a chain of stepping stones from the foreground gate
   toward the door. The capture has separated paving patches; the current map
   explicitly skips every third path cell. Preserve the intended route and make
   its visual sequence reach both ends.
4. **Graves:** gravestones flank the approach in the mock. The capture has much
   less visual density and a different arrangement. Keep the playable route
   clear and compare the rows after the camera is matched.
5. **Fence and gate:** corner and gate pillars, with visible torches, frame the
   mock. The current capture lacks those prominent pillars and torch lights. The
   checked-in game revision already joins the fence runs; the earlier disconnected
   fence report is not evidence that this revision is still disconnected.
6. **Vegetation and light:** the mock has large bare trees, dense dark ground
   growth and warm localized lights; the capture is sparse and has conspicuous
   green diamond-shaped ivy. Compare pack candidates before marking any element
   unavailable.

## Provisional intent and uncertainty

The mock depicts a chapel beyond a central approach, with the grave groups on
both sides and a fence/gate defining the foreground. The chapel and back fence
occlude background vegetation; foreground fence posts and trees occlude the yard.
Characters stand on the ground plane in front of the chapel. These relationships
are visible; exact grid cells, cardinal facing, footpoints and object scale in
character-height units still need a validated registration and explicit inference.
The mock's tall door, roof silhouette and warm lights may need an assembly or
variants; the existing game kit audit does not establish that no suitable pack
asset exists. The source map uses an 11 × 11 grid with gate `(5, 10)` and crypt
`(5, 1)`, which are current-game facts, not inferred mock coordinates.

The current search covers only the fantasy-isometric pack and one facing. Other
packs, facings and character assets must be considered before declaring a kit
gap. Full-catalog similarity rankings are candidate suggestions, not proof of
identity, orientation, fit or usability.

## Existing game assets

The current game's lock records the source of the provisional arch as
`wall-f6`, its wall as `wall-f1`, and its door as `door-a1` in the
SmallScaleInt fantasy isometric pack. Its grave, cross and headstone are
`stone-a4`, `stone-a5` and `stone-a13`; grass and paving come from `ground-a2`
and `ground-h1`. The fence is the rural zombie pack's `fence-b1`. The game
also locks the HD character pack's `1knight` and the undead pack's `6warrior`
and `5archer`. These are identities of assets in the current game, not verified
matches for the generated mock. The current map records the wall, door and arch
at 270 degrees; the mock's equivalent cardinal orientation has not yet been
measured against the game's projection.

## Retrieval diagnostic

Five mixed crops were compared using SigLIP and the east-facing fantasy pack.
The fresh run processed 25 of 467 eligible sprites, so its own search is
truncated. A historical full 467-sprite embedding set used the same model file
and processor; the 25 freshly encoded candidate vectors match it exactly.
That historical set did not record source hashes or a versioned preprocessing
signature, so the following is diagnostic rather than a fresh complete catalog
search. The five crops and candidate images were inspected in
`assets-local/review/1154/churchyard-historical-top3.png`.

| Mock crop | Historical top three | Visual finding |
| --- | --- | --- |
| Chapel entrance, steps and lights | `wall-d16`, `wall-d7`, `wall-f16` | Window wall pieces, not the entrance or a complete building. |
| Gravestone and ground | `wall-d1`, `wall-a16`, `wall-a7` | Wall pieces, not gravestones. |
| Fence, pillar and ground | `wall-d1`, `wall-d7`, `wall-f2` | Wall pieces, not the fence and pillar arrangement. |
| Path with knight and skeleton | `misc-d1`, `misc-d3`, `misc-d4` | Banners, not the path or characters. |
| Tree, fence and torch pillar | `wall-d16`, `wall-d7`, `wall-a4` | Window wall pieces, not the tree or fence. |

This is a retrieval failure on the inspected mixed regions. A scene reader
needs tighter individual-object crops or masks, appropriate asset families and
facings, and explicit review of proposed matches. These results do not establish
that the target objects are absent from the kit, and no automatic orientation,
scale, occlusion or registered comparison is claimed.

A second pass used tighter crops around a gravestone, stepping stone, fence
pillar, lantern and tree. Its fresh run encoded only one of 467 candidates;
the broader rankings again reuse the historical embeddings above. The crop and
candidate sheet is `assets-local/review/1154/churchyard-tight-historical-top3.png`.
The top three were `wall-d1`/`wall-a16`/`wall-a7` for the grave,
`ground-a20`/`ground-a5`/`ground-c5` for the stepping stone,
`wall-a16`/`wall-d1`/`wall-a15` for the pillar,
`wall-a2`/`wall-d7`/`wall-f7` for the lantern, and
`wall-d7`/`wall-d16`/`wall-a4` for the tree. Inspection shows none is a clean
match for the pictured object. The tighter crops still include background and,
for the pillar and tree, nearby fence details. Narrowing the boxes alone has not
made these rankings reliable; missing assets remain unproven.

A further diagnostic restricted the historical results by manually selected
filename families: `stone`, `ground`, `wall`, `misc` and `tree`, respectively.
The inspected sheet is `assets-local/review/1154/churchyard-family-historical-top3.png`.
The results were `stone-a3`/`stone-a10`/`stone-a11` for the grave,
`ground-a20`/`ground-a5`/`ground-c5` for the stepping stone,
`wall-a16`/`wall-d1`/`wall-a15` for the pillar,
`misc-b41`/`misc-b42`/`misc-b47` for the lantern, and
`tree-e1`/`tree-c1`/`tree-e4` for the tree. The first four groups still do not
show clean matches. `tree-e1` is a plausible bare-tree candidate by inspection
and is already locked by the game, but its fit and scale are unverified. These
are manually imposed family filters, not automatic classification, and may
exclude suitable cards; they cannot establish a kit gap.

As a diagnostic recall check, the game's current `stone-a4` and `stone-a13`
grave sources ranked 150th and 162nd of the historical 467 candidates for the
tight grave crop; the game's `tree-e1` ranked sixth for the tree crop. These
are not verified identities of the mock's objects, but they show why an
unqualified top-three cutoff would miss plausible game assets.

For one further local diagnostic, a person drew a rough mask around the grave
and composited it over the worker's brown background
(`assets-local/review/1154/churchyard-grave-manual-mask.png`). Against the
same historical vectors, `wall-a2`, `roof-g1` and `wall-a7` ranked first,
second and third. The game-used `stone-a4` moved from 150th to 64th and
`stone-a13` moved from 162nd to 184th. This mask is hand-drawn and imperfect;
it is not evidence of automatic segmentation or a reliable match. Background
removal alone did not solve this example.

A six-candidate local probe then cropped each transparent sprite preview to its
alpha bounds before encoding it against the same manual grave mask. The
inspected `stone-a4` preview's 256 × 256 canvas contained an alpha bounding box
of 59 × 81 pixels. Among three game grave candidates and three earlier wall/roof
decoys, the order was `roof-g1`, `wall-a7`, `stone-a4`, `wall-a2`, `stone-a5`,
`stone-a13`. This suggests transparent padding deserves a controlled test, but
it is a hand-selected six-item comparison against one imperfect mask. It does
not establish full-catalog recall, and the matcher has not been changed on this
basis.

A structured comparison of human observations is saved locally as
`assets-local/review/1154/churchyard-manual-observations.json`. With its explicit
category-priority order, it ranks the absent roofed chapel shell first and the
broken approach second. It preserves the already-connected fence and marks the
gate pillars, torches, grave arrangement and growth as unobserved. The inputs
were manually reviewed from the unregistered screenshot; this is not automatic
image inference, a matched-framing result, or a kit-gap finding.

A partial human annotation of the five inspected crops is saved locally as
`assets-local/review/1154/churchyard-manual-inference.json`. It records rough
image-space bounds, an approximate grave footpoint and visible-height ratio,
layer and visible occlusion hints; cardinal facings and unmeasured or clipped
footpoints are explicitly null. The ratios are screen-space estimates, not
registered tile positions or physical scale. This is a partial manual reference
for evaluating future inference, not a complete scene document.

## Newer game capture

The game worker subsequently committed a newer round-three capture at
`2c0461dce3cdbe653d828df800b59bdc4ba9e50f`: the logical 390 × 844 image is
780 × 1688 pixels, SHA-256
`82cbfacef338d1e831fab1b144ab4396f527320b3cad27a4723bec046b09e61b`.
The game worker's mock | older render | newer render sheet was inspected and
copied to `assets-local/review/1154/churchyard-round3-comparison.png`. The
previous ranked list and manual observation JSON describe `47e9544e`, not
this newer capture.

In the newer image a roof, continuous paved strip, joined visible fence segments, pillars,
torches, surrounding grass and additional vegetation are visible. Do not
repeat the old findings that these are all absent or that the path is three
separate blocks. The main remaining visual differences, in approximate order,
are:

1. The chapel and doorway are cropped at the right edge, while the mock centres
   the whole entrance; the knight remains much smaller and the foreground yard
   occupies a different part of the frame. The camera still needs matching. The
   game source notes that its current character-to-tile scale cannot show both
   the mock-sized knight and the whole yard at once; this needs a scene or asset
   scale change, not a claim that a camera crop alone solved it.
2. The visible building has a long orange roof and wall; the mock has a gabled
   stone facade, central arched door, steps, cross, side windows and overgrowth.
   The screenshot does not prove whether a closed shell exists outside the view.
3. The new approach is a continuous wide rectangular pavement, while the mock
   shows separate stepping stones leading toward the entrance. The gate and its
   full connection are outside or at the edge of this capture, so their route
   cannot be assessed visually here.
4. Grave placement, vegetation and lighting remain substantially different:
   the mock has denser grave rows and dark purple growth, bare framing trees and
   warm light pools; the render has more open grass, repeated small trees and
   bright green shrubs.
5. Pillars and lights are now present at visible fence points, but their shape,
   location and glow differ from the mock; the off-screen gate cannot be checked.

This is a human visual comparison of a committed capture, not a registered pixel
score, an automatic discrepancy list, or proof of gameplay and collision.

The subsequent fresh alpha-bounds run encoded all 467 currently eligible
 east-facing fantasy-pack previews for that same hand-masked grave. It records
the mask hash, model signature and each preview hash locally in
`assets-local/review/1154/churchyard-grave-trim-results.json`. Its top three
were `roof-g1`, `wall-a7` and `wall-a15`; game-used `stone-a4` was fifth and
`stone-a13` was 89th. The top-five image sheet was inspected at
`assets-local/review/1154/churchyard-grave-trim-top5.png`: the first four are
stone structural pieces and the fifth is a plausible grave candidate. The old
untrimmed historical set ranked these game-used candidates 64th and 184th for
the same mask, but that old set lacks per-preview hashes. This supports further
controlled testing of alpha bounds, not a proven improvement across objects,
facings or packs, and not a safe automatic top-three selection.

## Isolated camera study

A test-mode build was made in workspace scratch from game source at
`2c0461dce3cdbe653d828df800b59bdc4ba9e50f`, with staged public files copied
from the game workspace. The source lock hash was
`e16b76ac3697b6a69d9b1bccb902464e5ab798b272f1d51c9abfdc0e3a188e64` and the
staged public manifest hash was
`7fc3cb0edd87ea0def1e7f4e3cf440a9cbcb167331feed847669e026f1e7a936`; these
hashes do not by themselves establish every asset's build provenance. An
initial build failed because the isolated copy lacked the root TypeScript
configuration; copying it from the same commit allowed the test build to pass.

A scratch-only camera hook was added and the test build rebuilt. The baseline
camera zoom was about 0.643; an exploratory 1.8× zoom centred the player near
the mock's approximate screen position. Both real-engine stills were inspected:
`assets-local/review/1154/churchyard-camera-baseline.png` and
`assets-local/review/1154/churchyard-camera-zoom-study.png`. The enlarged frame
cuts the chapel out entirely. This verifies the framing tradeoff for this
experiment, not an exact character-height match, production change, registered
comparison or gameplay test. The game workspace itself was not modified.

## Visual pack audit

All 467 eligible east-facing sprites in the fantasy-isometric pack were rendered
into six local lineup pages under
`assets-local/review/1154/churchyard-pack-lineup/` and inspected. A separate
mock-crop comparison of manually selected candidates is
`assets-local/review/1154/churchyard-curated-candidates.png`. These are visual
candidates, not the embedding top-three results or validated placements:

- The chapel entrance could use `door-a1`, `wall-f6` and `wall-a12` as starting
  pieces for a door, arch and steps. They are separate sprites; the facade,
  roof, joins, facing and proportions still require a validated assembly.
- `stone-a4` is the closest of the three inspected grave markers to the tall
  plain mock stone, but its silhouette and base differ. `stone-a13` and
  `stone-a5` are a rounded marker and a cross, not the same shape.
- `ground-h3`, `ground-h6` and `ground-h8` are scattered square paving pieces;
  they are not exact matches for the mock's irregular stepping stones.
- `roof-g1`, `misc-c7` and `wall-a6` are column-like pieces, but none exactly
  matches the mock's square, pointed gate pillar. `tree-e1` and `tree-e3` are
  bare-tree candidates, though their silhouettes and scale need comparison in
  the game.

No single complete chapel or exact hanging lantern was identified in this
one-facing, one-pack audit. This is a bounded coverage gap, not a declaration
that no suitable asset exists in other packs or facings. A variant or assembly
may be needed after those sources are checked. Character sprites and the rural
fence pack were not part of this particular lineup.

The fantasy pack also has an animated `animations-props-torch-1` card that the
static east-facing sprite lineup did not include. Its first source frame was
inspected locally: it supplies flame rather than the mock's hanging lantern
fixture. The current game uses a torch effect. This confirms that the lineup is
not a complete audit of the pack's animation sequences and reinforces the need
to search other asset kinds as well as other packs before calling a gap.

A separate silhouette experiment normalized the hand-drawn grave mask and each
eligible preview's alpha silhouette before measuring intersection over union.
Among 467 east-facing fantasy sprites, `stone-a4` ranked second, but a generic
`shadow8` shape ranked first and wall or cliff pieces also ranked highly. The
inspected sheet is `assets-local/review/1154/churchyard-grave-silhouette-top5.png`.
An exploratory equal-weight blend of that silhouette score and the fresh
alpha-trimmed SigLIP score ranked `stone-a4` first, `wall-a7` second and
`ground-g12` third; the data and preview hashes are in
`assets-local/review/1154/churchyard-grave-blend-results.json`. The weight was
chosen for this probe, the query mask was drawn by hand, and this is one
object in one pack/facing. It suggests a comparison to test on more objects,
not a validated matcher or an automatic gap decision.
