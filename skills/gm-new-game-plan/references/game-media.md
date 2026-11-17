# Game thumbnail and trailer

A trailer is a montage of real gameplay snippets, each 2–5 seconds, totaling 15–30 seconds. Start the trailer ticket by listing every variety in the game's design doc and flow diagram: modes, piece sets or characters, signature animations (clears, combos, specials), and multiplayer or versus. Script one or more snippets per variety; show menus only briefly. Use the game's own music and sound effects, make portrait and landscape cuts, and ensure no frames are stretched or covered. The trailer plays in the app when the game is selected: keep both `trailer-*.mp4` cuts and a poster frame in the published media.

For example, a Blobs-like game's varieties list might be: blobs, blocks, both together, clear and combo animations, and multiplayer. This illustrative 20-second script covers each with a four-second entry. Replace scenario names with ones the game actually provides.

Give the game a JSON scenario list. Each entry starts a fresh game; `scenario` names a game-provided scenario, `seconds` sets its duration, and `inputs` happen at the listed seconds. Use logical actions with `phase: "down"` or `"up"`, or `click` with a Playwright selector for an HTML control. Use `surface: "page"` when menus or HUD live outside the canvas; otherwise the default canvas capture is faster.

```json
[
  { "scenario": "blobs", "seconds": 4 },
  { "scenario": "blocks", "seconds": 4 },
  { "scenario": "mixed", "seconds": 4 },
  { "scenario": "clear-combo", "seconds": 4, "inputs": [
    { "t": 1, "action": "softDrop", "phase": "down" },
    { "t": 2, "action": "softDrop", "phase": "up" }
  ] },
  { "scenario": "multiplayer", "seconds": 4 }
]
```

Replace the selector, scenario and actions with those the game actually exposes. Run `gm trailer <game-id> --script trailer.json --out public/media/` alone, without the full suite or another capture. It builds the game in test mode and writes `trailer-portrait.mp4` and `trailer-landscape.mp4`; The command uses software rendering by default; `--gpu` opts into GPU capture. Page captures include HTML overlays but can take substantially longer; `--fps 15` makes a shorter test capture at a lower frame rate. The game must use an SDK with trailer audio capture, and its audio assets must be present in the build. The command refuses unsupported captured SDK audio rather than silently omitting it. Audio played outside the SDK is not captured.

Watch and listen to both complete videos. Confirm the screens and gameplay match the current game, clear sounds land with their visual events, and the cuts and mix sound right. Use `gm-verify` for phone and desktop checks. Make `public/media/thumbnail.png` as a composed key-art scene: art only, with no logo or text and the centre left open for the shell's logo overlay (see SKILL.md). Check it by compositing the manifest logo over the centre at the card size and confirming nothing important sits under it. Never use a gameplay screenshot for the thumbnail; show gameplay in the trailer. The build copies the media into `dist/media/`; publish the build with `gm publish`. File refresh tickets when major visual or core gameplay changes make either asset stale.

To show a logo over the artwork, put a PNG, WebP, or SVG in `public/media/` and set the published game `manifest.json` field `logo` to its build-relative path, for example `media/logo.png`. The build must copy the image into `dist/media/`. Omit the field to show the game's text title. Publishing generates the responsive AVIF, WebP and PNG sizes automatically, including mobile sizes; supply one source image rather than hand-making variants.

Set `genres` in the game manifest to up to four genre names, for example `["puzzle"]`, so the library and spotlight show the game's genre.
