# Capability matrix

Which skill or method wins for each kind of work, and the evidence. The hourly meta-improve pass updates it (step 7,
"Capability gaps"). Once a row has a winner, tickets of that kind name that skill and the role label that loads it.

| Kind of work | Candidates | Compared? | Winner | Evidence |
|---|---|---|---|---|
| Sprite rebuild from multi-direction packs: trees | A procedural branch model; B leafless CC0 tree (Poly Haven); C image-to-3D (Hunyuan3D-2, TripoSR); D direct 2D with originals attached | Yes, #1094 on the RTX 4080: same GPU rig, finish pass and scorer for A–C | Provisional: C Hunyuan3D-2 from the original view; creator verdict pending (`dec_4bea60ce4c10e8bd`) | Tree E3 mean silhouette IoU / pixel similarity: A 0.28/0.79, B 0.34/0.81, C 0.36/0.81, D 0.25/0.80; TripoSR lost the branches. No arm passes the gates. [GPU bake-off](../../skills/gm-sprite-forge/references/gpu-bakeoff.md) |
| Sprite rebuild from multi-direction packs: foliage | Same four arms (B: scattered Poly Haven grass) | Yes, #1094 | Provisional: C Hunyuan3D-2, A procedural close; creator verdict pending (`dec_63c305f541835ca1`) | Flora B1: A 0.62/0.91, B 0.61/0.91, C 0.73/0.91, D 0.26/0.85; TripoSR made a flat card |
| Sprite rebuild from multi-direction packs: characters | A scripted body + scripted walk; B Quaternius CC0 goblin + its walk; C Hunyuan3D-2 mesh on A's skeleton; D direct 2D | Yes, #1094, 8 × 15 at 128 px | Provisional: A procedural; creator verdict pending (`dec_bf26410d0ca0dcc3`) | Goblin 01 walk silhouette IoU / motion correlation: A 0.31/0.41, B 0.29/−0.14, C 0.04/0.29, D 0.49/0.17. C misread the axe in a 29 × 34 px source frame. |
| Sprite rebuild from multi-direction packs: props | — | No | — | — |
| Concept image → 3D character from a pack (KayKit) | (A) three.js kitbash: `gm-asset-variants` + `scripts/style-check.py`; (B) Blender headless: `gm-3d`; (C) pack parts only: `gm-assets` search, then reshape or recolour | Bake-off running on Mossbeard (open-games #286, 2026-11-10) | — | #149 used A with no skill loaded: flat-shaded, flat-colour parts (3.00 verts/tri vs KayKit 0.7–1.0) |
| Concept image → 2D sprite from a pack | `gm-asset-variants` (sprite op), `agent-sprite-forge` (generation: ask Kevin first) | No | — | — |
| Image mock of a screen (not a game asset) | `gm-image-mock` | Partly: open-games #119 compared 3 styles × 3 image models × 3 tools | See #119 | — |
| Real screen vs target screenshot | `gm-dream-loop`, visual-verdict, pixelmatch, `gm look score/judge` | Three Blobs cases; framing differs | Provisional: `gm-dream-loop` with `gm look score/judge` | #707: gated verdicts gave actionable fixes; model observations need checking against the images. See [evaluation](concept-parity-evaluation.md). |
| Self-scoring loop | `gm-dream-loop`, visual-verdict, pixelmatch, Blender MCP | Three visual cases; Blender transport not verified | Provisional: `gm-dream-loop` with `gm look score/judge` | #707: dream-loop named the review order but tied scores; the installed core judge scored 6, 4, 4. Crops limit the comparison. |
