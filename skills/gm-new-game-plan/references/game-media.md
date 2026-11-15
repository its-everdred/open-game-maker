# Game thumbnail and trailer

Capture the current game, including its title, character selection, representative play, a clear and a combo. Give the game a JSON scenario list with 15–30 seconds in total. Each entry starts a fresh game; `scenario` names a game-provided scenario, `seconds` sets its duration, and `inputs` happen at the listed seconds. Use logical actions with `phase: "down"` or `"up"`, or `click` with a Playwright selector for an HTML control. Use `surface: "page"` when menus or HUD live outside the canvas; otherwise the default canvas capture is faster.

```json
[
  { "seconds": 5, "surface": "page", "inputs": [
    { "t": 1, "click": "[data-action=play]" }
  ] },
  { "scenario": "combo", "seconds": 10, "surface": "page", "inputs": [
    { "t": 1, "action": "softDrop", "phase": "down" },
    { "t": 3, "action": "softDrop", "phase": "up" }
  ] }
]
```

Replace the selector, scenario and actions with those the game actually exposes. Run `gm trailer <game-id> --script trailer.json --out public/media/` alone, without the full suite or another capture. It builds the game in test mode and writes `trailer-portrait.mp4` and `trailer-landscape.mp4`; The command uses software rendering by default; `--gpu` opts into GPU capture. Page captures include HTML overlays but can take substantially longer; `--fps 15` makes a shorter test capture at a lower frame rate. The game must use an SDK with trailer audio capture, and its audio assets must be present in the build. The command refuses unsupported captured SDK audio rather than silently omitting it. Audio played outside the SDK is not captured.

Watch and listen to both complete videos. Confirm the screens and gameplay match the current game, clear sounds land with their visual events, and the cuts and mix sound right. Use `gm-verify` for phone and desktop checks. Make `public/media/thumbnail.png` from a gameplay still. The build copies the media into `dist/media/`; publish the build with `gm publish`. File refresh tickets when major visual or core gameplay changes make either asset stale.

To show a logo over the artwork, put a PNG, WebP, or SVG in `public/media/` and set the published game `manifest.json` field `logo` to its build-relative path, for example `media/logo.png`. The build must copy the image into `dist/media/`. Omit the field to show the game's text title.

Set `genres` in the game manifest to up to four genre names, for example `["puzzle"]`, so the library and spotlight show the game's genre.
