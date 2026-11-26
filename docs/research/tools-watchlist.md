# Tools watchlist

Kevin (2026-11-26): "let's keep a list of interesting tools that may be a useful element for OGM game design, not planning to use it just yet."

These are interesting tools only. Nothing here is approved for use, purchase or integration. Recheck the licence and activity before adopting anything.

| Added | Tool | What it does | Possible OGM use | Licence / status |
|---|---|---|---|---|
| 2026-11-26 | [building-configurator-threejs](https://github.com/achrefelouafi/building-configurator-threejs) | Turns simple block geometry into a detailed building in real time (Three.js). | Game **editor mode**: let players rough out a building's shape and get a detailed building back. | MIT · 38★ · active (pushed 2026-11-23) |
| 2026-11-26 | [Pixel Composer](https://github.com/Ttanasart-pt/Pixel-Composer) · [gallery](https://pixel-composer.com/gallery.html) | Node-based pixel-art VFX and animation tool, with 153 gallery effects. | Technique reference for pixel combat VFX (the bake-off in Open-Games #1044). Kevin won't buy the $15 app. | MIT source · paid binaries |

## Pixel Plays (added 2026-11-26)
- **Links:** https://github.com/amirmushichge/pixel-plays (MIT code; music not MIT), play at https://pixel-plays-ruby.vercel.app/
- **What it is:** five tiny isometric pixel-diorama browser games, written in plain JS with a software rasteriser, depth buffer, 4-shade Bayer dither, hue-shifted ramps (violet shadows, warm lights), depth-buffer edge lines, long hard shadows, and grass that sways in whole pixels at 8 fps.
- **For OGM:**
  - its documented visual rules are a ready-made recipe for the pixel-finish pass (crisp bands, material edges, characters without dither);
  - MIT, so the shading and edge code can be studied or vendored;
  - a model for the marketing site's "small animated element per section".
- **Not:** a replacement for SmallScaleInt sprites (no assets) or for game logic.

## SkyboxMaker (added 2026-11-26)
- **Links:** https://skyboxmaker.com (pricing: /pro, terms: /terms)
- **What it is:** a procedural (not AI) WebGL skybox editor, strongest at space skies, plus an Atmosphere layer for planet-surface skies.
- **Exports:** panorama or cubemap for Godot, Unity and Unreal.
  - Free: 2K PNG (account needed).
  - €19: 8K, HDR and light data.
  - €49: 16K EXR.
- **Licence:** outputs are free for commercial use with no attribution; reselling raw skies as stock is banned.
- **For OGM:** skies and lighting for the PC render studio (Unreal/Blender pack stills and trailers) and HD-2D backdrops.
- **Limits:** no API; manual browser export with a GPU. Little use for isometric pixel gameplay, whose camera rarely shows the sky. Buying a pack needs Kevin's OK.

## SpriteCook snow & ice guide (added 2026-11-26)
- **Links:** https://www.spritecook.ai/blog/2d-pixel-art-snow-and-ice (SpriteCook: https://www.spritecook.ai, pricing /pricing)
- **The technique (no tool needed):**
  - per-pixel snow is baked at load in 4 stages that grow from seed clusters, open ground first and sheltered ground last, with noisy edges; a shader switches the stage per frame;
  - snow uses a 5-tone palette chosen by source brightness, and ice a 5-blue palette one step lighter than the water;
  - caps sit on lit sprite tops, 2–4 rows deep;
  - winter light is desaturated about 35% with blue multiply shadows;
  - ice freezes in by distance from shore, with glare lines and cracks;
  - 3 flake layers settle and fall again.
- **For OGM:** a seasons/weather pass on existing SmallScaleInt maps (snow biome without new art). It needs re-deriving for the isometric camera; the guide is 3/4 top-down.
- **SpriteCook itself:** an AI 2D art generator (web, REST API, MCP), free 40 credits a month, paid from $12/mo, commercial use allowed. It's a generator, so the creative-lane rules apply. Not adopted: it would need Kevin's OK for an account or spend.
