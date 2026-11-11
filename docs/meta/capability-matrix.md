# Capability matrix

Which skill or method wins for each kind of work, and the evidence. The hourly meta-improve pass updates it (step 7,
"Capability gaps"). Once a row has a winner, tickets of that kind name that skill and the role label that loads it.

| Kind of work | Candidates | Compared? | Winner | Evidence |
|---|---|---|---|---|
| Concept image → 3D character from a pack (KayKit) | (A) three.js kitbash: `gm-asset-variants` + `scripts/style-check.py`; (B) Blender headless: `gm-3d`; (C) pack parts only: `gm-assets` search, then reshape or recolour | Bake-off running on Mossbeard (open-games #286, 2026-11-10) | — | #149 used A with no skill loaded: flat-shaded, flat-colour parts (3.00 verts/tri vs KayKit 0.7–1.0) |
| Concept image → 2D sprite from a pack | `gm-asset-variants` (sprite op), `agent-sprite-forge` (generation: ask Kevin first) | No | — | — |
| Image mock of a screen (not a game asset) | `gm-image-mock` | Partly: open-games #119 compared 3 styles × 3 image models × 3 tools | See #119 | — |
| Real screen vs target screenshot | `gm-dream-loop`, visual-verdict, pixelmatch, `gm look score/judge` | Three Blobs cases; framing differs | `gm-dream-loop` with `gm look score/judge` | #707: gated verdicts gave actionable fixes; model observations need checking against the images. See [evaluation](concept-parity-evaluation.md). |
| Self-scoring loop | `gm-dream-loop`, visual-verdict, pixelmatch, Blender MCP | Three visual cases; Blender transport not verified | `gm-dream-loop` with `gm look score/judge` | #707: dream-loop named the review order but tied scores; visual-verdict reversed it. Crop and pose differences limit the comparison. |
