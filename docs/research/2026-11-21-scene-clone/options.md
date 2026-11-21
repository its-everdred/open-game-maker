# Scene clone: research and bake-off design

Status: preliminary research; no bake-off has been run and no winner has been selected.

## Candidates

| Stage | Candidate | What it provides | Limits to test |
| --- | --- | --- | --- |
| Detection | [Grounding DINO](https://github.com/IDEA-Research/GroundingDINO) | Open-set, text-conditioned boxes. | A box does not capture occlusion, ground contact, or story; small painted objects may be missed. |
| Segmentation | [SAM 2](https://github.com/facebookresearch/sam2) | Promptable masks for images. | Needs prompts and category labels from elsewhere; masks do not infer depth. |
| Segmentation | [SAM 3](https://github.com/facebookresearch/sam3) | Concept-prompted segmentation. | Its [license](https://github.com/facebookresearch/sam3/blob/main/LICENSE) has specific terms; check model access, terms and local hardware before adoption. |
| Detection and captions | [Florence-2](https://arxiv.org/abs/2311.06242) | A unified model for vision tasks including detection and captioning. | Evaluate on pixel-art crops and verify the selected weights' license. |
| Retrieval | [SigLIP 2](https://arxiv.org/abs/2502.14786) | Image and text representations for retrieval and localization. | Benchmark with actual rendered sprites and mock crops; high semantic similarity may miss a silhouette or orientation mismatch. |
| Retrieval | [DINOv2](https://github.com/facebookresearch/dinov2/blob/main/MODEL_CARD.md) | Visual features suitable for nearest-neighbor image retrieval. | Compare crop/background sensitivity and small-object recall against SigLIP 2 and CLIP. |
| Retrieval | [CLIP](https://arxiv.org/abs/2103.00020) | Text and image embeddings, a useful baseline. | Its semantic alignment is not proof that a sprite matches a particular view. |
| Dressing | [Wave Function Collapse](https://github.com/mxgmn/WaveFunctionCollapse) | Local tile adjacency constraints. | Cannot by itself preserve a focal point, routes or authored story; contradictions need reporting. |
| Dressing | [Poisson disk sampling](https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph07-poissondisk.pdf) | Seeded minimum-spacing samples for a density field. | Uniform spacing can look artificial; reserve paths and use masks and authored clusters. |
| Comparison | [SSIM](https://ece.uwaterloo.ca/~z70wang/publications/ssim.pdf), [LPIPS](https://arxiv.org/abs/1801.03924), [DreamSim](https://arxiv.org/abs/2306.09344) | Complementary structural and perceptual similarity measures. | None establishes gameplay, depth order, narrative, or correct assets; scores depend on framing and registration. |

## Provisional direction

Keep parsing, retrieval, placement and measurement separate and inspectable. Record source image dimensions, camera, grid anchors and confidence; fit the ground plane only from validated correspondences. A single ground-plane homography cannot recover height or reliably register an imagined perspective. Preserve object footpoints and depth separately and flag uncertain or unavailable assets instead of inventing matches. Retrieve candidates from rights-eligible real assets at the target camera and present the top three with provenance. Place landmarks and walkable routes first, then seeded dressing in regions with exclusion zones. Never let a similarity score override a visual or gameplay failure.

This is a hypothesis, not the winner. Do not ship a command claiming to clone a scene until its outputs are measured in a real engine and its adapter can write real game data.

## Bake-off protocol

Use the approved Caravan yard image and the same rights-eligible pack, output viewport, camera, budget and starting game for all three arms. Record the exact image, pack versions, seeds, camera, elapsed effort and generated artifacts. A is a freehand reconstruction; B uses the staged pipeline; C begins with a real-asset blockout and a beauty pass, then reconstructs that result. C's reference differs from the original, so report similarity both to its own mock and to the original approved mock; do not compare the former directly with A/B as if they had the same target.

Capture matching engine stills and clips. Register only with documented ground anchors, then save side-by-side and 50% overlays. For each fixed region report silhouette, colour and dressing density, a registered image metric, and observed defects including paths, occlusion and depth. Review the images and motion at phone size; log each iteration and stop at a measured plateau. Keep the full history, including regressions, rather than selecting only a favorable frame. A human visual judgment remains necessary for atmosphere and narrative.

## Evidence still needed

Locate the exact approved image and its review record, identify the pack and game revision, obtain rights-compatible local model availability, then perform all three arms and post their clips and overlays as a review round. No clip, metric or winning approach is asserted here.

## Approved reference and observed scene

The open-games #3 review submission `dec_1111ea4ad60bd7da` labels round 12 option D “Caravan yard”; the subsequent issue verdict says Kevin liked it. The submitted phone composite is 390 × 693, SHA-256 `ae6a34429fec0f79fac5ee41ffb49de33330ea76f747366a3f72f39c958034b9`; its 828 × 1472 source composite is `d5fdbd6b87f883536cff58750bfd6b50ca83b1003d0865ef4d67f081f308f00a`. The scene background is generated, with a real HD Mage frame composited over it. The recorded references include the SmallScaleInt fantasy isometric and HD character packs, version 2026-11-01. Keep this material in the local library, not the repository.

On inspection, the visual hierarchy is a foreground ruined gate and entering figure, a paved trading court with three carts, and a large covered stall backed by roofed stone buildings. Walls, gates and roofs establish occlusion; torches create warm pools against dark stone and sparse grass. Treat these as observations to validate against candidates, not exact asset identities. The mock contains invented geometry: availability, collision and consistent tile scale still need verification against the pack. The verdict requests a larger town and separate dioramas, so reproducing this single frame alone is not a complete town design.

The current game renderer uses a Phaser scene and the SmallScaleInt adapter; its village scene is a game-specific map rather than the generic `gm scenery` format. A game-agnostic clone command therefore needs an explicit adapter contract or must fail with a clear unsupported-game result: writing the generic scenery file would not prove that this game consumes it. Existing `review/3-options-distinct` images predate the approved mock and are not valid bake-off results.

For single-view layout, [Total3DUnderstanding](https://arxiv.org/abs/2002.12212) jointly estimates camera, layout and objects for indoor scenes. Its target domain differs substantially from generated isometric pixel art; it is a research comparison, not evidence of reliable reconstruction here. Existing project skills `gm-assets`, `gm-design-loop`, `gm-asset-variants` and `gm-verify` already cover asset provenance, visual iteration, variants and visual review; the missing bridge is a reproducible scene decomposition and game-specific placement loop.

## Capture feasibility check

A readiness-aware software-rendered capture of the existing Dusk Helm village test build succeeded at 390 × 693; local artifact SHA-256 `7a3c1aae5d3b07dd1da618c87bddba58434038f0b3bd1b429ad08302630bf2f3`. The image shows a sparse paved slice, partial stall, a wall section and a fenced animal. It is not a reconstruction of the approved yard and is not an A/B/C result. The first blank screenshots were captured before the game's `__gm.ready` signal; wait for that signal and advance the test hook before judging a frame. The source workspace was at `3a91b92f08134add4171b65a0a7492f48b3f0e1e`; the existing build's exact source provenance still needs verification before using it as a baseline.

## Exploratory layouts, not a bake-off

A scratch copy of the game at the revision above was built in test mode with the existing staged assets. Two 390 × 693 stills were captured at the same camera: a freehand placement and a placement generated from a hand-written region list. The latter replaced palisades with stone wall segments. Both retained the existing house assembly and used the existing stall and cart assets. Local review artifacts are `freehand-draft.png` and `regions-draft.png` with corresponding 50% overlays under `assets-local/review/1154/`.

Neither is a valid completed bake-off arm: the scene has not been registered to the reference, the region list and matches were manually authored, no metric or motion was measured, and the third arm is absent. Inspecting the overlays reveals major differences in camera framing, wall silhouette, house coverage, lighting, scale and dressing density. These results do not establish whether a parsing or retrieval model helps.

The fantasy pack card records `processing: local-only`. The generated mock skill prohibits sending paid-pack renders to a hosted generator, and the blockout is a render of that pack. A local image generation stack was not found in the checked cache or Python environment. Do not send this blockout to the broker or treat a simple colour filter as the requested beauty pass. A rights-compatible local generator is needed to test that arm with the same pack.

## Local visual retrieval probe

A small offline probe used the cached `openai/clip-vit-large-patch14` image encoder on CPU, with approximate rectangular crops of the approved phone composite and 25 existing environment kit images. The collection card permits `vision-input` and requires `local-only` processing; inference and the contact sheet stayed local. Transparent kit pixels were composited over a fixed dark brown background. The crops are approximate, not masks, and the candidate set is a hand-selected kit, not the full catalog.

| Crop | Top three kit labels (cosine similarity) | Visual observation |
| --- | --- | --- |
| Stall | market stall 0.777, house roof 0.702, chest 0.687 | The first has the right canopy and posts, but is smaller and less detailed than the mock. |
| Cart | cart 0.784, roof 0.698, market stall 0.661 | The first is recognizably the same kind of cart, though the mock's silhouette differs. |
| Door | wallflora 0.666, torch 0.660, ground 0.658 | None is the door; the small crop contains a bright torch and surrounding wall. |

The inspected local sheet is `assets-local/review/1154/clip-kit-diagnostic.png`. This probe supports a visually reviewed shortlist, not automatic matching or a claim that CLIP wins against other encoders. In particular, masking, transparent padding, sprite scale, view angle and candidate coverage need a controlled benchmark. It does not resolve the three-arm scene bake-off or select a winning pipeline.
