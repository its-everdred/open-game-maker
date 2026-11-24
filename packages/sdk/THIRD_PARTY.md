# Third-party notices

## pixelfx

Vendored at commit `fe7103c36d94e02f2d7df7d8f7a341e493837cde` under the MIT License.

The following text is carried from `third_party/pixelfx/NOTICE.md`:

> **Hugo Duprez.** `src/core/sim.js` and the effects that say so at the top of their file adapt Sprite Fusion's
> open-source pixel art VFX (https://www.spritefusion.com/pixel-art-vfx/fire), Copyright (c) 2026 Hugo Duprez, MIT License.
>
> **Patch Pixel.** The font in `gallery/fonts` is Patch's own and is not covered by this repository's MIT license. See
> `gallery/fonts/NOTICE.md`.

Only pixelfx's reviewed `src/` tree is consumed. The excluded gallery font is not distributed by `@gm/sdk`.

## FastNoise Lite

`fastnoise-lite` 1.1.1 is used under the MIT License. Copyright (c) 2023 Jordan Peck and contributors; JavaScript port by Patrick U.

## idb

`idb` 8.0.3 is used under the ISC License for the browser save outbox.

## fake-indexeddb

`fake-indexeddb` 6.2.5 is used only by save outbox tests under the MIT License.

## recast-navigation

`recast-navigation` 0.43.1 is an optional peer dependency used under the MIT License. Its project star-rule exception remains pending; games without the approved `nav.navmesh` capability do not load it.

## Tone.js

`tone` 15.1.22 is an optional peer dependency used under the MIT License. It is loaded only when a game calls the song player.

## ZzFX

`zzfx` 1.4.0 is used under the MIT License. Its recorded dependency exception covers the package's sub-1,000-star repository.

## Effekseer for WebGL

Effekseer for WebGL 1.80.8 is used under the MIT License. Copyright (c) 2011 Effekseer Project. `@gm/sdk/vfx` ships its
script and `effekseer.wasm` from `third_party/effekseer`, loaded only when a scene creates effects.
