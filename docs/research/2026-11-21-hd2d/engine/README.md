# HD-2D engine clips

The procedural test scene (`packages/sdk/src/hd2d/fixture/`) on both renderers at both quality tiers: all three
capabilities through `createHd2d`, then one clip per capability. Each clip is 6 s at 60 fps, 640×360, H.264, seed 1;
each still is its first frame.

| Renderer | Quality | All (`createHd2d`) | Lighting | Focus | Particles |
|---|---|---|---|---|---|
| three.js | high | [mp4](three-high-all.mp4) · [png](three-high-all.png) | [mp4](three-high-lighting.mp4) · [png](three-high-lighting.png) | [mp4](three-high-focus.mp4) · [png](three-high-focus.png) | [mp4](three-high-particles.mp4) · [png](three-high-particles.png) |
| three.js | low | [mp4](three-low-all.mp4) · [png](three-low-all.png) | [mp4](three-low-lighting.mp4) · [png](three-low-lighting.png) | [mp4](three-low-focus.mp4) · [png](three-low-focus.png) | [mp4](three-low-particles.mp4) · [png](three-low-particles.png) |
| Phaser | high | [mp4](phaser-high-all.mp4) · [png](phaser-high-all.png) | [mp4](phaser-high-lighting.mp4) · [png](phaser-high-lighting.png) | [mp4](phaser-high-focus.mp4) · [png](phaser-high-focus.png) | [mp4](phaser-high-particles.mp4) · [png](phaser-high-particles.png) |
| Phaser | low | [mp4](phaser-low-all.mp4) · [png](phaser-low-all.png) | [mp4](phaser-low-lighting.mp4) · [png](phaser-low-lighting.png) | [mp4](phaser-low-focus.mp4) · [png](phaser-low-focus.png) | [mp4](phaser-low-particles.mp4) · [png](phaser-low-particles.png) |

Re-capture one from `packages/sdk` (it builds the fixture, steps the clock frame by frame and checks the result with
ffprobe):

```sh
pnpm exec tsx src/hd2d/fixture/capture.ts --renderer phaser --quality low --toggles lighting,focus,particles --facade --out <dir>
```

It prints the first frame's sha256; the same seed gives the same hash.
