# HD-2D focus experiments

These are isolated, synthetic renderer proofs for issue #1147. They do not load asset packs.

- Open `layered.html` for authored 2D depth bands, tilt-shift, layer blur and a crisp foreground sprite.
- Open `three.html` for scene-depth BokehPass, focus adjustment and a separate height-haze shader.
- `captures/` contains the Chromium screenshots and a five-second A/B clip.
- Recreate the captures from the repository root with `node prototypes/hd2d-depth-focus/capture.mjs` in the OGM dev environment (Playwright is resolved from `apps/web`; Chromium and ffmpeg are also required). `three.html` loads three.js 0.180.0 modules from jsDelivr, so the Three proof requires network access. Browser capture was run successfully in this workspace; no handheld phone performance measurement was made.

The capture script runs the complete browser sequence. Its three.js stills show the current synthetic scene and effects; the BokehPass sample uses a deliberately subtle aperture so it stays legible at this small viewport.
