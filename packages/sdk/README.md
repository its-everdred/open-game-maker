# Game SDK

## Shared player settings

The host owns the settings menu. Subscribe with `host.settings.onChange` and pass the received settings to
`audio.applySettings(settings)` so sound and music levels are applied independently. Existing builds that select only
`mute` and `volume` must forward `musicVolume` too. Handle `textScale` and `reduceMotion` in the game UI.

Games may declare `gameOptions` in their manifest, for example
`[{ "id": "hints", "label": "Hints", "kind": "toggle", "default": true }]`. The host presents these options and sends their values
in `settings.gameOptions`. Options can also be `choice` (with labelled `choices`) or `number` (with `min`, `max`, and `step`); subscribe to settings and apply them in the game. Options are stored per game on the device.
Both `musicVolume` and `gameOptions` are optional for compatibility with older hosts.
The emitted JSON Schema checks option structure; cross-field checks for unique IDs, valid defaults, and number steps
are enforced by the Zod manifest validator used by the SDK and host.

To let players change keyboard controls, declare the complete code-to-action `controlBindings` mapping in the manifest,
matching the mapping passed to `runtime.attachInput`. The shared menu sends `keyboardBindings`, and the runtime applies
them to its keyboard input. Games using their own input handling must apply that field themselves. Escape remains a host
hotkey and cannot be rebound in the shared menu. List any additional `runtime.attachInput` hotkeys in the manifest's
`controlReservedKeys` array so the menu does not offer them as bindings.

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

## Editor integration

Games describe their palette in the manifest: categories have an `id`, `label`, and `kind`; items name a `prefab`,
`label`, and category id, with optional `thumbnail`, `tag`, and `hint`. The host owns the palette UI. Use stable prefab
and category ids so the same editor can present a game's items without game-specific controls.

The host stores edits as design transactions and sends the resulting document and patches as `design.apply`. Implement
`GameInstance.applyDesign` to apply the validated document to the live game. Creator-placed entities use `origin:
'creator'` and `props.pose.position`; transforms update `props.pose` and removal removes the entity. A game that keeps
older design data should continue to read it when adding support for these editor poses. Selection and placement
validation reach the optional `setSelection`, `pick`, and `validatePlacement` hooks; implement those hooks for the
items the game exposes. The host's selection and camera messages are not themselves persistent design changes.

For a camera-based editable surface, add `editor.project` to manifest capabilities and implement
`screenToWorld(nx, ny)` on the instance. The host supplies normalized frame coordinates; return a world-space position
or `null` when the ray misses. The editor uses the result for placement and translation, preserving negative world
coordinates. Games without the capability retain the legacy logical-coordinate mapping.

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

## Scenery data

A game can keep `scenery.json` at its root. Version 1 records placed asset IDs and transforms, terrain bands, a lighting
preset, and camera framing. IDs must appear in `assets.lock.json`; the build validates the file and publishes it beside
the game. `gm scenery list`, `gm scenery add <id> <asset-id> --position x,y,z`, and `gm scenery move <id> --position
x,y,z` read and update the same file. `gm scenery render --out scenery.png` captures a standalone still using the locked models, even before a game build exists.

`@gm/sdk/scenery` exports `createScenery` for a Three.js group, `frameScenery` for a camera, and `SceneryHistory` for
undoable edits. `createSceneryController` swaps the rendered group when an edit finishes loading, ignoring stale loads. Pass a `loadAsset` callback that supplies a fresh object for each placement. Declare the game's world-space
X/Z play-area rectangle to omit any item or terrain segment whose bounds intersect it. The renderer owns terrain geometry
and materials; the caller owns loaded assets and is responsible for disposing the group when finished.

For the shared editor, `sceneryPalette` supplies the scenery categories and lock-filtered prefabs.
Pass each model's lockfile SHA as `sha256` to allow the editor to render its thumbnail only from matching locked bytes.
`sceneryToDesign` imports scene settings and placements into a design document using caller-supplied stable entity IDs;
`sceneryFromDesign` validates the effective document against the lock and produces the scene file format. Pose yaw is
stored in degrees in the editor and radians in scenery data. These adapters do not themselves persist transactions.
The Water tab paints grass, path, and water bands; each stroke is one undoable edit. Games that accept these edits
declare the global `scenery.terrain` custom control shown by the 3D template, so terrain survives a build switch.

### Painted scenes

Lock the backdrop and each transparent cut-out image as separate assets. Add their IDs to `scenery.json`:

```json
{
  "version": 1,
  "dimension": "2d",
  "viewport": { "width": 640, "height": 480 },
  "backdrop": {
    "assetId": "forest-background",
    "landscape": { "fit": "cover", "anchor": [0.5, 1] },
    "portrait": { "fit": "contain", "anchor": [0.5, 0.5] }
  },
  "items": [
    { "id": "oak-1", "assetId": "oak-cutout", "position": [240, 180, 0], "rotation": [0, 0, 0],
      "scale": [1, 1, 1], "layer": "mid", "parallax": 0.5 }
  ],
  "terrain": [],
  "lighting": "warm-forest",
  "camera": { "position": [0, 0, 1], "target": [0, 0, 0], "zoom": 1 }
}
```

Set `dimension` to the game's dimension, so the no-build editor can offer models in a 3D scene before one is placed.
Set `viewport` to the game's logical size; the 2D template and no-build preview default to 640×480. The fit rule is
chosen by display aspect; anchors range from 0 (left/top) to 1 (right/bottom). Item positions and
image dimensions use game pixels, centred on the item; Z orders items within each back/mid/front layer. Scale multiplies
the image's intrinsic size, rotation Z is in radians, and parallax is the fraction of camera movement applied to the
item (1 follows the world, 0 stays fixed). The backdrop always stays behind the items. The editor can swap a locked
image as the backdrop and move, scale, delete, change depth, or adjust parallax on each cut-out. Once a game has wired
the shared renderer, changing this file and its lock changes the scene without changing game code.

For Canvas games, load each referenced image from the asset loader, put its source and intrinsic size in a map, and
call `drawPaintedScenery(context, sceneryFromDesign(doc, lockedAssets), images, viewport)` before drawing gameplay.
The viewport supplies logical width and height, optional physical `aspect`, and optional camera displacement. Phaser games can use
`createPaintedScenery` from `@gm/sdk/phaser`: supply the scene and a function resolving locked IDs to asset URLs,
call `update` when the design changes, `resize` when the viewport changes, and `dispose` on scene shutdown. See the
2D template for the game lifecycle integration. Games must preserve scenery globals and entities in their design
schema and expose picking and placement for the shared editor.
For games mixing world-space models with screen-space sprites, `screenToWorld(nx, ny, prefab)` receives the optional
prefab being placed or moved. Use it to select the appropriate projection; existing games may continue accepting only
the first two arguments.

Workers can reconcile creator edits by saving the latest `gm design current --json` result and running
`gm scenery sync --design <snapshot.json>` before changing `scenery.json`. Sync replaces the scene file with the
validated scenery in that snapshot; obtain a fresh snapshot first.

A game can opt in by declaring `scenery` in its manifest capabilities. The Vite artifact plugin maps
`scenery.json` into the build's design document with stable entity IDs (or initializes empty scene settings when the
file is absent). The 3D template demonstrates loading each locked model with `AssetLoader.object`, applying design
updates through the scenery controller, and protecting the game's play-area rectangle.
