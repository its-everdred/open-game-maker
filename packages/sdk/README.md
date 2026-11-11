# Game SDK

## Lazy asset groups

Register assets with `--phase lazy:backdrop-nim`; unmarked assets belong to boot. During the match countdown, call
`await assets.loadGroup('backdrop-nim', ({ loaded, total }) => updateProgress(loaded, total))` before using the backdrop.
Repeated calls reuse the loaded group; call `assets.unloadGroup('backdrop-nim')` when the match ends to release the SDK's
in-memory file and model cache. Lazy budgets default to 1.5 MiB mobile and 4 MiB desktop per group. Override byte limits
in `.gm/game.json`, for example `{"budgets":{"lazy":{"backdrop":{"mobile":1572864,"desktop":4194304}}}}`;
the `backdrop` entry applies to `backdrop-*` groups, and an exact group name takes precedence.

## Trusted host origin

Set the optional game-manifest `hostOrigin` to the exact HTTP(S) origin allowed to frame a build. `boot` prefers an
explicit `BootOptions.hostOrigin`, then the manifest value, and otherwise keeps the referrer-derived fallback for
existing builds. Paths, credentials, query strings, and fragments are not valid origins.

## Narration

Narration manifest entries use this shape:

```ts
type NarrationManifestEntry = {
  kind: 'narration';
  key: string;
  audio: string;
  alignment: string;
};
```

Load the two signed asset URLs after creating the SDK audio instance, unlock audio from a user gesture, and play on
the voice bus:

```ts
import { createAudio, SpokenText } from '@gm/sdk/audio';

const audio = createAudio({ rng });
await audio.unlock(); // Call from a user gesture.
const line = await SpokenText.load({ key, audioUrl, alignmentUrl });
line.play({ onSentence: (_index, sentence) => showCaption(sentence) });
```

Use `SpokenText.fromText(text, lang)` when rendered audio is unavailable. It keeps sentence callbacks and uses the
browser's `speechSynthesis` voice.

## Editor camera

The host sends `editor.camera { mode: 'follow' | 'free', target?: entityId }` (a room watcher's Follow/Free toggle).
Any role may send it: the camera is presence, not design state. `boot` hands it to `GameInstance.setCamera(mode, target)`
and answers `error { code: 'unsupported' }` when the game has none; throw for an unknown `target`.

- `follow`: the camera tracks `target`, or the game's default player when it is absent.
- `free`: the editor pan/zoom (`EditorCamera` in 3D, `PhaserEditorCamera` in 2D): wheel zoom (and pinch in 3D),
  middle/right-button or touch drag to pan.

Obey it only in edit mode; play mode keeps the manifest rig. `templates/game-2d` and `templates/game-3d` show both.

## Authority modes

A game declares who simulates in its manifest:

```json
{ "net": { "authority": "per-seat", "maxSeats": 4 } }
```

- `'host'` (default, and what a manifest without `net` means) keeps the v1 path: the primary seat's browser runs the
  only simulation, sends a snapshot every third step (20 Hz), and peers draw 100 ms behind and interpolate.
- `'per-seat'` makes every seat simulate the whole game at the fixed 1/60 s step. A seat applies its own input in the
  tick it is sampled (no round trip), reconstructs the others from tick-stamped redundant inputs (a three-tick window
  at 30 Hz), publishes `capture({ seat })` at `net.seatStateHz` (10 Hz), and folds `digest()` into a shared checksum
  at 2 Hz. A disagreement is settled by a recovery snapshot from the primary seat; four hard resyncs inside a minute
  trip a breaker and report the seat `desynced` instead of looping.
- `'rollback'` is reserved: a manifest that declares it refuses to boot until its engine lands.

`gm.net.mode` is the gate for anything mode-specific; `gm.net.role` keeps its v1 meaning (`host` for the primary
seat, `peer` for any other) and is not an authority signal. The per-seat surface is `localSeat`, `epoch`, `tick`,
`started`, `onSeats`, `onStart`, `now()`, `frameFor(seat, tick)`, `rng('shared' | seat)` and `digest()`, plus the
`net.*` counters in `renderInfo().net`.

A per-seat manifest must implement `MultiplayerHooksV2`: `capture({ seat })` returns that seat's owned slice and
`capture({})` the shared one, `restore(snapshot)` applies exactly the slice it is given, and `digest()` returns
integers in canonical order — seats ascending, entity ids sorted by code unit, positions quantised with `toUnits`
(1/256 of a unit). Declaring the mode without those three hooks throws `ModeMismatchError` (`MODE_MISMATCH`) from
`boot` instead of silently running host authority.
