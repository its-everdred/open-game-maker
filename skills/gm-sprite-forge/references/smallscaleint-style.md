# SmallScaleInt measured style

These observations describe the studied packs, not universal rules for pixel art. Measurements came from the 2026-11-19 sprite pipeline study. `study.py` is the research script; `measure_sheet.py` and its shared `spritemetrics.py` are in this skill. The research also used `blender_iso_rig.py` and `carve_hull.py` to verify the projection.

## Knight rebuild: approved visual round

Kevin marked round 74 of the Knight 64 Walk rebuild as matching. Its experimental camera fit used a 50° tilt and 45° yaw, with an orthographic span of approximately 2.83 world units. The light setup used a 65° elevation, -30° azimuth relative to camera yaw, and sun strength 3. The shadowless sheet has eight directions and 15 frames per direction in 64 px cells. These are settings for this particular hand-built rig, not a replacement for the measured projection below.

The visual verdict does not imply the quantitative gates passed. Round 74 measured silhouette IoU 0.636 (target ≥ 0.80), pixel similarity 0.803 (≥ 0.93), palette distance 0.868 (≤ 6), edge F1 0.807 (≥ 0.60), and luminance histogram distance 0.591 (≤ 0.25). Frame counts matched. Motion correlations by direction E, SE, S, SW, W, NW, N, NE were 0.385, 0.540, 0.512, 0.677, 0.588, 0.583, 0.836, 0.556 (target ≥ 0.70 in every direction). The local experiment holds the generated sheet, rig and comparison media under `assets-local/experiments/sprite-pipeline/knight-1012/`; library files are not committed.

- **Projection:** Ground A1 has a 128 × 64 px diamond in a 256 px image, with origin (128, 208). The orthographic camera is 60° from vertical and yaw 45°; the tile is 16 px thick. The tile silhouette was measured by `study.py` using `spritemetrics.py`; projection was checked with `blender_iso_rig.py` and `carve_hull.py`.
- **Sheets:** Knight 64 uses 64 px cells in a 960 × 512 sheet; Goblin 01 uses 128 px cells in a 1920 × 1024 sheet. Both have 15 columns and 8 direction rows. Rows are E, SE, S, SW, W, NW, N, NE, matched against the named angle folders. Measured with `measure_sheet.py` and `study.py`.
- **Characters:** Knight 64 Walk Shadowless has 27 sheet colours, binary alpha, a typical 14 × 22 px bounding box and foot y 42. Goblin 01 Walk has 374 sheet colours, a typical 29 × 34 px box and foot y 90. Measured with `measure_sheet.py` / `spritemetrics.py` and summarized by `study.py`.
- **Palette and outline:** No palette quantisation or outline pass is indicated: 467 tileset south views contain 51,860 distinct colours, and rim/interior luminance ratios are approximately 0.8–1.05. The 64 px knight's small palette follows its size and materials. Measured with `study.py` / `spritemetrics.py`.
- **Light and shadow:** Props use 3–4 stepped shading plateaus. Stone A12 has approximate luminance levels 130, 109 and 62; its contact shadow is black at alpha approximately 165 (range 128–200). Measured with `study.py` / `spritemetrics.py`. Near-black partial-alpha pixels are classified as shadows by `spritemetrics.py` and excluded from its object mask.

## Crispness (#1338)

`spritemetrics.crispness` on the Idle frame 0 of 6Barbarian, 3Wizard and 5BarbArcher (S, SE, E; the hero references):
alpha is binary; 46-69% of neighbouring object pixel pairs share a colour; of the pairs that differ, 13-52% step by
CIE76 dE >= 20 (hard steps; Barbarian 13-18%, Wizard 30-39%, Archer 46-52%); the rim averages 0.2-4.5 L* darker than the
pixel inside it, a darkened local colour rather than a black outline. Finish B on the Warrior base body: 49% shared,
1% hard steps, the fuzz Kevin saw. Finish C is tuned to these.

## Additional measured examples

The following per-frame values are summaries from `study.py`, using `spritemetrics.py` for masks, colour, luminance, alpha and IoU. Bounding boxes and feet are in cell pixels. Colour coverage is the number of colours covering 90% of object pixels; motion is consecutive-frame silhouette IoU.

| Animation | Box | Foot y | Colours/frame (90% coverage) | Sheet colours | Luminance bands | Partial-alpha share | Rim/interior luminance | Motion IoU |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Knight 64 Walk Shadowless | 14 × 22 | 42 | 15 (9) | 27 | 4.8 | 0.00 | 0.93 | 0.83 |
| Knight 64 Idle | 13 × 22 | 43 | 15 (9) | 26 | 4.9 | 0.00 | 0.88 | 0.96 |
| Knight HD Walk | 35 × 56 | 95 | 144 (75) | 788 | 12.3 | 0.41 | 0.86 | 0.81 |
| Goblin 01 Walk | 29 × 34 | 90 | 89 (59) | 374 | 7.8 | 0.07 | 1.05 | 0.57 |
| Tileset Player Walk | 31 × 43 | 89 | 50 (25) | 193 | 7.8 | 0.14 | 0.93 | 0.72 |

`study.py` measured Stone A12's south view at 74 × 61 px, 165 colours and 7–10 luminance bands; Wall A1 at 82 × 168 and 190 colours; Roof A1 at 5,804 colours and Tree A1 at 3,403. Props use separate 256 × 256 views N/E/S/W. Stone A12's inferred yaw order is 0°, 270°, 180°, 90°, verified by `carve_hull.py`.

`study.py` measured the HD knight light angle at 88–97° and the tileset player at 84–97° (screen-up is 90°). The goblin shadow lies about 5 px up-screen from the feet, with alpha 1–200, and remains fixed across directions. The 64 px knight's shadowless sheets have binary alpha; HD sheets retain partial-alpha edges. The knight's 29 animations and the examined HD animations each use 15 frames per direction (`measure_sheet.py`, `study.py`).
