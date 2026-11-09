---
name: gm-multiplayer-ready
description: Load for every game, for any single-player to multiplayer conversion job, and before the two-client verify. Keeps the game shaped for rooms and checks the shape.
---

# Multiplayer-ready games

Every game ships shaped for a room from day one, even when only one person plays it. A watcher must never see
private text; the room enforces that, and the two-client verify proves it.

## The eight rules

1. Input never mutates the world directly: it becomes an `InputFrame` consumed by `applyInput(playerIndex, frame)` in
   the fixed step.
2. All per-player state lives in `players: Map<playerIndex, PlayerState>`; no singleton `player`.
3. Entity ids are host-minted, globally unique strings; never array positions or per-session counters.
4. Spawn points are design data (`design/spawns.json`), at least `maxPlayers` of them.
5. Authority is declared, not assumed: a game sets `net.authority` in its manifest (`'per-seat'` or `'host'`) and
   keeps its simulation deterministic; game logic never assumes a server.
6. `serializeSnapshot()/applySnapshot()` cover everything visible; transient effects are derived, not synced.
7. HUD reads `players.get(localPlayerIndex)`; camera rig follows the local avatar.
8. `tick(seconds)` and `render_game_to_text()` work with `players.length ≥ 2`; under per-seat authority every seat
   runs the step itself, so the same frames must always produce the same state.

## Authority modes

The room relays; it never simulates. Which client simulates is the manifest's choice:

- `net: { authority: 'host', maxSeats: 4 }` — the owner's browser runs the only simulation. Peers send input frames
  and draw the host's snapshots. This is what every game written before the field existed does, and it stays
  byte-for-byte the old path.
- `net: { authority: 'per-seat', maxSeats: 4 }` — every seat simulates the whole game at the fixed 1/60 s step. A
  seat applies its own input in the tick it is sampled (no round trip), reconstructs the other seats from
  tick-stamped redundant inputs, publishes its owned state, and proves agreement with a shared checksum. A
  disagreement resolves through a recovery snapshot from the primary seat.

A per-seat manifest must implement three more hooks (`capture`, `restore`, `digest`); declaring the mode without them
refuses to boot with a mode-mismatch error rather than silently dropping back to host authority. Never describe the
room or any service as the authority, and never put game rules in a service: if the primary seat leaves, the room
pauses for it and then ends.

## What a seat may receive

Hidden data is never sent. A per-seat game implements `view(recipient)`: the SDK calls it once per recipient on the
sending client and encodes exactly what it returns, addressed to that recipient — an omitted field is a field that seat
never held. Without `view` the mode broadcasts `capture({ seat: localSeat })` exactly as before. `view` needs
`authority: 'per-seat'`: host authority packs one snapshot for every peer and cannot filter it, so a host-mode game
that declares `view` refuses to boot instead of promising privacy it cannot deliver. `net.event` is the only reveal
and the SDK never redacts it. A redacted field is *absent*, never `null` or zeroed, and `restore` merges the keys it
is given.

```ts
view(recipient: number): Snapshot {
  const slice = captureOwned(state, localSeat);
  if (recipient === localSeat) return { tick, state: slice };
  const { secret, ...visible } = slice.player;       // every other recipient gets no `secret` key at all
  return { tick, state: { seat: localSeat, player: visible } };
}
```

The seven limits a design must respect:

1. A shared seed reveals the future; a hidden draw uses `rng('private')`.
2. `rng('private')` is one stream per seat, not a vault: reveal the value you drew, not a generator you keep drawing.
3. Determinism leaks through timing; keep genuinely secret information out of the simulation.
4. A private field that feeds a public value is public, and surfaces as a desync loop rather than a leak.
5. Recovery cannot repair a redacted field; if the redacted part matters to the recipient, it was never private.
6. Payload size is not a channel, but the number and timing of reveals still are.
7. The room is not a trust boundary for content: hide what a seat may not have, do not police peers.
`digest()` excludes every private field: such a word would be an oracle for it and can only surface as a desync.

## What the SDK gives you

The runtime's `gm.net` (`runtime.net` after `boot`) is the whole network surface:

- `mode` is `'per-seat'` or `'host'` — gate new behaviour on it, never on `role`. `role` keeps its v1 meaning
  (`host` for the primary seat, `peer` for any other), and `localSeat` is this client's seat.
- Remote input arrives in the fixed step as ordinary frames whose `playerIndex` is the sender's seat, so the same
  `applyInput` handles every player. `onInput` only observes it.
- `onPlayerJoined`/`onPlayerLeft` announce seats; `onSeats`/`onStart` announce a per-seat match; `sendEvent`/`onEvent`
  carry rare one-off events, not state.
- Host mode sends a snapshot every third step (20 Hz) and peers draw 100 ms behind. Per-seat mode publishes
  `capture({ seat })` at `net.seatStateHz` (10 Hz by default) and checksums the whole state twice a second.
- `now()` gives the server-time mapping; `epoch`/`tick`/`started` describe the match; `frameFor(seat, tick)` returns
  the frame this client holds; `rng('shared')`/`rng(seat)`/`rng('private')` return seeded streams so two seats draw
  the same shared numbers and never each other's private ones. `localSeat` is `null` for a spectator, which attaches
  no camera and asks for no HUD.
- Per-seat diagnostics ride in `renderInfo().net`: `inputGaps`, `lateInputs`, `clockResyncs`, `recoveries`, `desynced`.

The game supplies `MultiplayerHooks` on its instance as `net`:

- `MultiplayerHooks.spawn` gets `(playerIndex, playerId)` with a host-minted id (`p<index>`); add that avatar to
  `players`. `MultiplayerHooks.despawn` removes it.
- `MultiplayerHooks.snapshot` returns `{ tick, state }`; `MultiplayerHooks.applySnapshot` replaces the visible state
  on a peer.
- `MultiplayerHooks.hud` takes a seat and returns that seat's `HudModel`, never another player's private field.
- Per-seat authority adds `capture({ seat })` for a seat's owned slice and `capture({})` for the shared slice,
  `restore(snapshot)` which must apply exactly the slice it is given (never the whole state), and `digest()` which
  returns integers in canonical order — seats ascending, entity ids sorted by code unit, positions quantised with
  `toUnits` (1/256 of a unit). A `capture({})` slice must be independent of any seat's position.

Interpolation convention: put each visible thing under `state.entities[id]` with its position in `p` (number or number
array) and rotation in `r` (yaw number or `[x, y, z, w]` quaternion). The SDK lerps `p` and slerps `r` between two
snapshots; every other field snaps.

Caps: an input frame is at most 256 bytes on the wire (8 axes, 32 buttons, never text); a snapshot is at most 64 KiB
after packing. An oversized payload is dropped with one warning, so keep snapshots to what is visible.

## Starting shape

From the instance repository root, `gm new game-multiplayer <game-slug>` writes the scaffold to `games/<game-slug>/`: a
`players` map, `applyInput`, four spawns in `design/spawns.json` with `maxPlayers` 4 in `gm.manifest.json`, `net` hooks,
and a HUD plus camera that follow `localPlayerIndex`. Grow the game from there; do not copy its grey boxes into the theme.

To convert an existing single-player game, follow `references/convert-single-to-multiplayer.md` step by step.

## Check

Run the static checker after any change to input, players, entities, spawns, snapshots or the HUD:

```sh
node .claude/skills/gm-multiplayer-ready/scripts/check.ts .
```

It prints `rule N file:line message` and exits 1 on: no `applyInput(...)` call (1), a module-scope `player` singleton
(2), entity ids from array positions or counters (3), fewer spawns than `maxPlayers` (4), `snapshot`/`applySnapshot`
missing or empty in the `net` hooks (6), and a HUD that never reads `players.get(...)` (7). Exit 0 is a pass; exit 2 is a
usage error or no `gm.manifest.json`. Ambiguous shapes print as notes; read them. Rules 5 and 8 need two running
clients. It needs `typescript` installed in the game (the template has it).

## Multi-client verify

Run it after a conversion, after changing snapshots or input, and before calling a multiplayer feature done, from the platform repository against a local rooms service (never the public hostname):

```sh
pnpm --filter @ogm/gm-verify scenario multi-client --game <gameDir> --link bad --out shots/mp
```

Four browsers (`--clients 2`/`3`) share a protocol-2 room; it asserts seats welcomed in 2 s from 0, no private canary at
a watcher, watchers' design equal to the primary's per rev, all playing in 500 ms, each peer moving only its avatar, a
3 s drop rejoining and a longer one forfeiting (two seats skip it, in `unchecked`) and drafts reaching every seat. The
report has `clients` and `seats[]` (ticks, RTT, delay p95s, desyncs, recoveries). `--link clean` is unimpaired, `--link
@<report.json>` replays its seed, `--seed <n>` sets `link.seed`. `--start <name>` uses that entry of `qa/starts.json`,
only `teams`: `"none"` (all 0) or `"alternate"` (team n % 2); other seat teams fail; probes carry `start`, `seatTeams`.

## Done

Done means `gm check`, `gm test` and the checker are green, `gm run` shows two avatars when two seats are spawned,
and the matching verify passed for any networking change (`multi-client` for a v2 game, `two-client` for a v1 one).
After `gm run`, post a still with `gm chat post`.
