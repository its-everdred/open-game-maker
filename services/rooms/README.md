# `@ogm/rooms`

The rooms service is a relay-only Colyseus process. A seat's browser remains authoritative for its own simulation; the service keeps membership, the room pin, phase, presence, `lastRev`, and — for a protocol-2 room — the seat table and one epoch.

The OGM-002 systemd unit starts it with:

```ini
ExecStart=node services/rooms/dist/main.js
```

Set `OGM_ROOMS_SEAT_RECONNECT_SEC` in the rooms environment to change the per-seat reconnect window; it defaults to 30 seconds and accepts 1–3600 seconds.

It reads `OGM_ROOMS_PORT`, `OGM_WS_TOKEN_SECRET`, `OGM_ROOMS_INTERNAL_SECRET`, `OGM_API_INTERNAL_URL`, and `OGM_GAMES_ORIGIN` through `@ogm/config`. The process binds only `127.0.0.1`; real values belong in `~/.config/ogm/env/rooms.env` with mode `0600`.

The pinned multiplayer packages are `colyseus@0.18.10`, `@colyseus/core@0.18.24`, `@colyseus/ws-transport@0.18.4`, `@colyseus/schema@5.0.43`, `@colyseus/testing@0.18.6`, and `@colyseus/sdk@0.18.9`.

For local development:

```sh
pnpm --filter @ogm/rooms dev
```

## Protocols

One process serves both protocols; each room runs exactly one, stored in `state.protocol` and compared on join.

| | protocol 1 | protocol 2 |
| --- | --- | --- |
| Seats | `members[].playerIndex`, owner 0, players 1… | a fixed seat table `seats[0..maxPlayers-1]`; `members` is rebuilt from it |
| Authority | the owner's browser | each seat's own browser (`net.start.mode`, opaque to the room) |
| Match state | `phase`, `playRev` | plus `epoch`, `startAt`, `pausedAt`, `seed`, `primarySeat` |
| Reconnect | `allowReconnection(120 s owner / 60 s player)` | a 30 s per-seat window owned by the room |
| Creator leaves | the room ends (`host-left`, `owner-closed`) | the seat forfeits like any other |
| Editing | `design.tx`, `presence`, `draft.*`, `kick`, `phase` | identical, unchanged |

A room's protocol is chosen at create (`POST /internal/rooms`, `POST /api/v1/games/:gameId/rooms`) and never changes. A join whose `protocol` differs is rejected with `PROTOCOL_MISMATCH`; reload to join.

In protocol 2, a seated player may pause a playing match. The pauser may resume it; when exactly two non-forfeited seats are occupied, either player may resume. The room refuses a resume while an occupied seat is disconnected and announces a three-second countdown before continuing. The existing configurable seat rejoin window applies while paused; once the pauser has forfeited, any seated player may resume, and the room starts the countdown itself once no seat is awaiting reconnection. Spectators cannot pause or resume.

For per-seat authority, the room first probes every seat for its simulation tick, then announces a future boundary tick and waits for every connected player to acknowledge it before starting the countdown. A client that has already passed it cannot safely rewind; it is disconnected and the rejoin window and forfeit policy apply, as they do for a client that has not acknowledged the boundary within that window. A player who joins during a prepared pause starts short of the boundary and runs up to it, so a reload neither restarts the epoch nor counts as late. A seat that does not answer the probe within two seconds runs an SDK built before the boundary protocol: the match then pauses at the room's current tick for every seat (`net.pause`) and resumes with `net.resume`, as those builds expect.

## Seats and teams

- The room assigns seats; a client never does. `grant.seat` is only a claim about the joining user's own seat, and a claim the room does not recognise is `SEAT_TAKEN`.
- A seat is `{ seat, userId, name, team, connected, ready, forfeited }`. Numbering is stable for the life of the room; the occupant can change.
- Teams are a property of the seat number: `teams: 'none'` gives every seat team 0, `teams: 'alternate'` gives seat *n* team *n % 2*. `teams: 'custom'` is not implemented and is rejected at create.
- Spectators are `state.spectators: string[]` — user ids with no seat and no authority. A room admits them only when created with `spectators: 'on'`; otherwise a join past `maxPlayers` is `ROOM_FULL`.
- `maxPlayers` is clamped to 1…8 (default 4). Every seat row is created with the room, so a full room is visible before anybody joins.

## The epoch: one match, one derived tick

`net.start.request` (primary seat only) mints an epoch when every occupied, connected, non-forfeited seat is ready, or unconditionally with `force: true`. The room then publishes:

```
tick(now) = floor(((pausedAt || now) - startAt) * 60 / 1000)
```

in `net.tick` at 1 Hz, and in every `net.start`, `net.pause`, `net.resume`, `net.epoch.end` and late-join `welcome`. `startAt = now + 1000 ms`; the room cannot measure RTT and does not try.

A pause records `pausedAt`; a resume shifts `startAt` by the paused duration. The tick therefore freezes while paused and continues from the same value afterwards — there is no counter to reconcile, and the room never steps a simulation. `net.end.request` (primary only) ends the epoch: every seat number is kept, every forfeited seat is released, every `ready` returns to `false`, and the room goes back to the ready check.

## Event routing

A protocol-2 `net.event` carries `{ epoch, id, seq, from, target, to?, team?, round?, data }`. The room validates the envelope and size caps, re-stamps `from` with the sender's seat, validates `to`/`team`, and routes:

| Message | Recipients |
| --- | --- |
| `net.inputs`, `net.state`, `net.checksum`, `net.recovery` | every other seat in the epoch |
| `net.event` `target: 'all'` | every other seat and every spectator |
| `net.event` `target: 'seat'` | the sessions of seat `to` |
| `net.event` `target: 'team'` | the sessions of the seats on team `team` |
| `net.recovery.request` `scope: 'shared'` | the primary seat |
| `net.recovery.request` `scope: 'seat' \| 'events'` | the named seat |
| `net.signal` | the sessions of seat `to` |

Delivery never returns a message to its sender: it has already applied it locally. `data`, `frames`, `snapshot` and `events` are relayed byte-identical and never parsed. Ordering is the transport's per sender; order across senders is not guaranteed, so a game orders by `round` and its own sequence.

A duplicated `net.event` is applied once by the **client**, not the room: `EventInbox` in `packages/contracts/src/net-events.ts` dedupes `(from, id)`, reports a sequence jump as a gap, and answers `missing()` for the recovery request. A relay that deduped would be interpreting.

## Disconnects: pause, rejoin, forfeit

Every seat has a 30 s window, the creator's included.

| Moment | Room |
| --- | --- |
| a seat's last session drops | `connected: false`, `net.seat`/`net.seat.offline`, window armed; a running epoch pauses for everyone (`pauseOnDisconnect`, default on) |
| the drop happens before `startAt` | the start is cancelled: `net.start.cancel { reason: 'seat-offline' }` |
| the same user joins again inside the window | seat re-bound, a unicast `net.start` + `net.tick`, and the match resumes when no seat is still offline: `net.resume` carries the shifted `startAt` |
| the window expires | `forfeited: true`, `net.seat`/`net.seat.forfeit`, primary re-elected when it was that seat |
| a session leaves with `CloseCode.CONSENTED` | forfeit immediately, no window |
| every seat is forfeited | `ended { reason: 'abandoned' }` |

A seat is offline only when it has no sessions left, so two devices on one seat behave like one. The creator's departure follows exactly the same rule: there is no "host leaves, room ends" in protocol 2. `pausedForHost` stays an editing-phase rule and never fires during a match.

The forfeit *policy* (`continue` / `skip` / `surrender`) is the game's: the room announces who forfeited and when, every client applies the same policy to the same ordered announcement, and a policy that must end the match reaches the room as the primary's `net.end.request`.

## Ruleset pinning

`rulesetHash` is computed **by the client** from the simulation-relevant manifest fields and sent at create and at join. The room compares the two strings and nothing else: equal, or either side absent, passes; two different pins are `RULESET_MISMATCH { expected }`. The room never reads a manifest, so it cannot compute the hash itself.

## What the room never gains

No simulation, no checksum comparison, no arbitration, no snapshot storage, no per-game module loading, no `eval`, and no reading of `data`, `frames`, `snapshot` or `events`. It also never gains matching, room discovery, chat, tournaments, a round engine, or persistence of gameplay state.

## Tests

`pnpm --filter @ogm/rooms test` runs the 775 lines of protocol-1 relay tests unchanged beside the protocol-2 suites. The v1 assertions are the proof that protocol 2 is additive; `services/rooms/test/helpers.ts` speaks whatever protocol the room under test runs.
