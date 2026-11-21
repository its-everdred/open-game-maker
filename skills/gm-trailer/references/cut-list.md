# Cut list

`cut.json` sits beside the trailer in `review/<ticket>/` and is the single source for `scripts/assemble.py` and
`scripts/selfcheck.py`. Paths are relative to the file. Raw takes and rendered audio are large: keep them out of git
(the host's `assets-local/review/<game>/trailer/` or a scratch folder) and point `src` there with a relative path.

```json
{
  "fps": 30,
  "size": [1280, 720],
  "inventory": {
    "location": ["bedrooms", "kitchen", "town", "hill", "cave", "inner door"],
    "move": ["slash", "psi fire", "psi ice", "enemy attack", "party heal"],
    "boss": ["bugon", "lygon"]
  },
  "music": [
    { "file": "audio/outside.wav", "bpm": 108, "start": 0, "beats": 16 },
    { "file": "audio/battle.wav", "bpm": 152, "start": 3.158, "beats": 32, "gain": 0.9 }
  ],
  "shots": [
    {
      "id": "storm-hook",
      "src": "takes/storm",
      "in": 1.2,
      "beats": 4,
      "crop": [0, 90, 960, 540],
      "crop_to": [0, 120, 960, 540],
      "scale": "nearest",
      "tags": { "kind": "hook", "location": "bedrooms" },
      "cues": [{ "t": 0.4, "file": "audio/sfx.wav", "from": 12.1, "len": 1.5, "gain": 0.8 }]
    }
  ],
  "targets": { "min_shots": 12 }
}
```

- **inventory**: every key is a tag name; each listed item must appear in some shot's `tags` under that key, or
  the self-check fails. Fill it from the game, not from what was easy to capture.
- **music**: segments play in order, each `beats` long from `start` seconds into its file (start on a downbeat).
  Shots consume the beats in order and may not straddle two segments, so the change of track is also a cut.
- **shots**: `src` is a folder of frames named `f00000.png…` (or `.jpg`) at `fps`, or a video file; `in` is where the shot
  starts in it. `beats` sets its length at the current segment's tempo. `crop` is `[x, y, w, h]` in source pixels
  and must be the output's aspect; `crop_to` pans to a second position of the same size across the shot. Punch in
  by cutting to a tighter crop, not by zooming. `scale` is `nearest` (pixel art, default) or `smooth`.
- **tags**: `kind` is one of `hook`, `world`, `action`, `boss`, `reveal`; the other keys match the inventory.
  `action` and `boss` shots count as action time.
- **cues**: the game's own sound effects, `t` seconds after the shot's in-point; `from`/`len` cut one effect out of
  a longer file. Take them from the capture's sound log so they land on the frame that made them.
- **targets** (optional) override the self-check's defaults: `min_shots` 12, `max_average` 2.5 s, `max_shot` 4 s,
  `min_action_share` 0.35, `max_frozen` 0.8 s, `min_cuts_seen` 0.8.
