# Lit motes proof

Procedural three.js 0.186 scene comparing warm, soft particles over a low-poly forest silhouette. A point light flickers near the ember cluster; mote colors and depth-scaled point size provide the lighting/depth cue. Points use a custom shader for soft halos and additive cores. This is a stylized lighting approximation, not physically lit particles or depth-of-field. No asset pack files are used.

## Run and capture

From the repository root, start a static server (for example `python3 -m http.server 4173`) and open `http://127.0.0.1:4173/prototypes/hd2d-lit-motes/`. Captures made at 960×600: [`still.png`](captures/still.png) and [`lit-motes.webm`](captures/lit-motes.webm) (7 seconds at 5 fps). The scene requires WebGL; do not claim a browser capture if WebGL is unavailable.

## Notes

The proof uses 150 CPU-updated point sprites, deterministic initial positions, a shallow depth spread, exponential fog and one flickering point light. Desktop visual proof only; phone CPU/GPU timing, occlusion behavior and shader fallback remain for the prototype ticket.
