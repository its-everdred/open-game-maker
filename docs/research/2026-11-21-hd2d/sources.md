# HD-2D focus research sources

Checked 2026-11-21. Primary references used in `depth-of-field-and-tilt-shift.md`:

- Phaser 3 FX guide (Bokeh/TiltShift scope, WebGL-only and camera/object application): <https://phaser.io/oss/docs/phaser/concepts/fx>
- Phaser 3.90 Bokeh API (constructor, `isTiltShift`, blur controls): <https://phaser.io/oss/docs/api-documentation/3.90.0/class/fx-bokeh>
- Phaser license (MIT): <https://phaser.io/download/license>
- Phaser render pixel-art configuration (`pixelArt`, `roundPixels`): <https://docs.phaser.io/api-documentation/3.90.0/typedef/types-core>
- three.js `DepthTexture` API: <https://threejs.org/docs/pages/DepthTexture.html>
- three.js `BokehPass` API: <https://threejs.org/docs/pages/BokehPass.html>
- three.js `Fog` / `FogExp2` guide: <https://threejs.org/manual/pages/fog.html>
- three.js `FogExp2` API: <https://threejs.org/docs/pages/FogExp2.html>
- three.js material depth controls: <https://threejs.org/docs/pages/Material.html>
- three.js renderer pixel ratio and output buffer: <https://threejs.org/docs/pages/WebGLRenderer.html>
- pmndrs postprocessing docs and Zlib license: <https://pmndrs.github.io/postprocessing/public/docs/>
- Arm mobile graphics guidance on postprocessing bandwidth/performance: <https://developer.arm.com/community/arm-community-blogs/b/mobile-graphics-and-gaming-blog/posts/finding-and-fixing-hidden-performance-problems-in-mobile-games-with-arm-performance-studio>

Tool and skill scan:

- Repo checked for `codeart2d`, `generate2dmedia`, and shader/VFX skills: none are installed in the agent skill catalog. `impeccable` is installed and its local workflow references were read; its context launcher could not create the engine cache under the workspace's write policy.
- Phaser skill packs are external examples, not installed skills used by this work.
