# Pixel leaves proof

Procedural Phaser 4.2.1 scene exploring crisp palette-matched falling leaves over a depth-layered forest wash. The slow sinusoidal gust is a minimal shared-wind stand-in; it is not yet a world-position wind field. No asset pack files are used.

## Run and capture

From the repository root, start a static server (for example `python3 -m http.server 4173`) and open `http://127.0.0.1:4173/prototypes/hd2d-pixel-leaves/`. Captures made at 960×600: [`still.png`](captures/still.png) and [`pixel-leaves.webm`](captures/pixel-leaves.webm) (7 seconds at 5 fps). `Phaser.CANVAS` is selected so the proof can run in software-rendered browsers.

## Notes

The proof uses Phaser's native emitter and procedural 8×8 leaf texture at nearest-neighbor sampling. It demonstrates rate, gravity, lifetime, tint, scale and wind-driven horizontal velocity. Desktop visual proof only; phone frame timing and Phaser WEBGL comparison remain for the prototype ticket.
