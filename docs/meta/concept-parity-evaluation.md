# Concept parity evaluation

This is an in-progress evaluation for core #707. Do not treat a candidate as a winner until the same cases have been
run with comparable inputs and the required ranking, actionable differences, runtime, token use, and headless behavior
have been recorded. The core scorer and judge from #706 have landed; see the local scorer probe below.

## Inputs and constraints

The local Blobs evidence includes the goo piece pair and earlier bead and run sheets, the play-screen target and
round 7b still, and the Mossbeard card and current model still. These are local review assets; do not copy them into
this repository. The Executor confirmed that the concepts are Kevin's own generated art and the stills contain CC0
KayKit models or code-rendered goo, with no paid-pack art. Copy the inputs into the workspace before sending them to
the existing broker client, `skills/gm-image-mock/scripts/request-mock.py`.

## Preliminary pixelmatch probe

On 2026-11-10, pixelmatch 7.1.0 and pngjs 7.0.0 ran locally with pixelmatch's per-pixel threshold 0.1 and its default
anti-alias handling. These are mismatch percentages, not visual quality scores; the 0.5% web pass threshold in the
marketplace workflow is not met. No model tokens were used. The measured times include diff PNG encoding and writing,
but exclude image loading and resizing. They are one local run, not a benchmark.

| Case | Inputs and preprocessing | Mismatched pixels | Compare and write |
|---|---|---:|---:|
| Goo | Left and right 464 × 464 halves of `goo-piece-match.png` | 66.37% | 186 ms |
| Play screen | Center 670 × 1448 crop of target, candidate scaled to that size by nearest neighbor | 81.17% | 1,359 ms |
| Mossbeard | 384 × 688 concept-card crop and current 384 × 688 model still | 96.26% | 440 ms |

The crops retain different backgrounds, framing and poses; nearest-neighbor scaling also adds artifacts. Therefore these
numbers do not establish whether the iteration order agrees with the Executor's review. The bead and run sheets have
different layouts and have not been registered to the same subject and view. Pixelmatch produces a spatial heatmap, not
a ranked list of specific edits. It can run headlessly in this worker as a diagnostic, but this probe does not validate
the candidate skill's full auto-fix loop or establish a winner.

## Blender MCP probe

The upstream repository and its license report MIT. On 2026-11-10, its addon at commit
`2e4b0bc294694b1570d76ed01be657c22e6d02a0` was imported into factory Blender 4.3.2 locally. Calling
`BlenderMCPServer().get_scene_info()` directly returned the three default scene objects. This is a method smoke test,
not an MCP protocol test. Its server explicitly refuses to start with `blender --background`; a virtual-display
attempt did not return a result and was interrupted; a second attempt with software GL timed out after 45 seconds without output. No addon was installed and no cloud backend was configured. The
MCP workflow has not yet been tested on the three comparisons. `nvidia-smi` was unavailable in this workspace; do not
assume the NVIDIA-dependent Hunyuan3D or TRELLIS backends are available.

## Candidate provenance

- `visual-pixel-perfect` was removed from aura-frog in commit `469df09fb26b9b11e48af570f5f32442ca1a96d7`;
  its last parent is `e47d23b3377e88792bedcd96d9475b948be38b96`. The marketplace page points to a path that no longer
  exists on the default branch. The repository reports MIT, but review the historical file and its license before
  adapting or redistributing it.
- `godot-create-3d-assets` is an additional MIT-licensed candidate found in GitHub search. It targets Godot 4 and a
  Godot MCP with bounded jobs, whereas these cases use the project's Three.js workflow. Godot was not on this worker's
  PATH, so it has not been run on the cases and is not an evidence-backed winner.

- GitHub search also found `arjun988/blender-skills` (repository MIT license, last pushed 2026-11-06). Its
  `qa-review` skill asks for multi-angle screenshots, reference comparison and a severity-ordered ship verdict. It
  does not specify a numeric parity score, and its viewport capture depends on Blender MCP. It has not been run on the
  three cases; it is a candidate, not a selected winner.

## Dream-loop broker probe

After the Executor confirmed the images' provenance, a workspace copy of `goo-piece-match.png` was sent once through
`request-mock.py --kind look` on 2026-11-10 using the gated dream-loop rubric. The broker returned 3/10, with no tier
fully passed and a fail verdict. Its differences included the pinched silhouette, highlight placement, and material;
they were specific enough to suggest edits, though some background and crop observations need human verification. This
is one case, not a ranking or an evaluation of the full loop. The record did not expose token counts. The result reported
`cost_usd: 0.0500243` despite the stated no-spend expectation, so further broker calls were stopped. Do not infer that
this path is free from the request interface. The broker source copies the Claude CLI `total_cost_usd` result into this field and runs its second-login CLI with the API key removed; it does not establish how the account is billed. The other cases and candidates remain untested through the broker.

## Core local scorer probe

After #709 merged, `gm look score` ran without a broker on all three local pairs. Goo used the two 464 × 464 halves
of the pair; Mossbeard used the 384 × 688 card crop and current still; the play target and current still were passed
at their original dimensions, with the scorer stretching the candidate to the target size. No perceptual adapter was
configured, so LPIPS was skipped. No vision tokens were used. These are individual measurements, not a ranking.

| Case | SSIM | Colour histogram distance | Edge IoU |
|---|---:|---:|---:|
| Goo | 0.5284 | 0.4973 | 0.0901 |
| Play screen | 0.0280 | 0.3982 | 0.0278 |
| Mossbeard | 0.0802 | 0.6960 | 0.0267 |

The scores are affected by the framing, pose and background differences described above; the play inputs also have
different aspect ratios. The bead, run and piece-match sheets have not been registered to an equivalent view, so the
required iteration ranking is not established. The core judge remains untested here because its broker path reported
a charge on the earlier probe. A later single serial run measured end-to-end CLI times (including process startup and file writing) of 6.174 s for goo, 7.663 s for play, and 5.753 s for Mossbeard. These are not repeated benchmarks.

## Provisional goo iteration ranking

A further exploratory comparison used `concept-goo-crop.png` (116 × 116) as target. To select a similar L-shaped
piece, the beads sheet was cropped at `(1228, 620, 110, 110)` and the runs sheet at `(625, 620, 106, 110)`; both
crops were mirrored horizontally. The candidate from the right half of `goo-piece-match.png` was used whole. The core
scorer stretched each candidate to 116 × 116. Pixelmatch used nearest-neighbor scaling and threshold 0.1.

| Iteration | Core SSIM (higher is closer) | Pixel mismatch (lower is closer) |
|---|---:|---:|
| Beads | 0.1884 | 76.90% |
| Runs | 0.1277 | 79.84% |
| Piece match | 0.5298 | 66.00% |

Both metrics rank runs below beads, contrary to the supplied review order, while ranking piece match highest. This
probe is not a fair validation of either metric: the crops differ in framing, neighbors, orientation and size, and the
piece-match candidate is a different close-up. Preserve those caveats when interpreting the reversal; a controlled
fixed-camera sequence is needed to establish whether either metric tracks the reviews.
