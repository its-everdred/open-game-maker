import type {
  ActionFrame,
  AuthorityMode,
  GameManifest,
  MultiplayerHooks,
  MultiplayerHooksV2,
  NetSeat,
  NetStart,
} from '@ogm/contracts';

import type { Rng } from '../core/rng.js';
import {
  assertByteLength,
  decodeBase64,
  encodeBase64,
  NET_LIMITS,
  NetPayloadTooLargeError,
  packJson,
  unpackJson,
} from './codec.js';
import { HostChannel } from './host.js';
import { PeerChannel, type WireSnapshot } from './peer.js';
import { NET_STATE_CHANGES, playerId, RoleStore, type NetPlayer, type NetRole, type NetStateChanges } from './roles.js';
import { EventDelayRing } from './diagnostics.js';
import { ModeMismatchError, resolveAuthorityMode } from './mode.js';
import { PerSeatMode, type PerSeatDiagnostics } from './modes/per-seat.js';

export interface GmNet {
  readonly role: NetRole;
  readonly localPlayerIndex: number;
  readonly players: ReadonlyArray<NetPlayer>;
  onPlayerJoined(callback: (playerIndex: number) => void): () => void;
  onPlayerLeft(callback: (playerIndex: number) => void): () => void;
  onInput(callback: (playerIndex: number, frame: ActionFrame) => void): () => void;
  sendEvent(event: unknown): void;
  onEvent(callback: (event: unknown) => void): () => void;
  readonly snapshotHz: 20;
  readonly interpolationDelayMs: 100;
  /** The authority mode this instance runs (`'host'` when the manifest declares none). */
  readonly mode: AuthorityMode;
  /** This client's seat, or `null` for a spectator — the one honest value that cannot be confused with seat 0. */
  readonly localSeat: number | null;
  /** The room's elected primary seat, or `null` when no seat is eligible. */
  readonly primarySeat: number | null;
  /** The seat table: who is seated, on which team, connected, ready, forfeited or spectating. */
  readonly seats: readonly NetSeat[];
  /** `''` outside a per-seat match. */
  readonly epoch: string;
  readonly tick: number;
  readonly started: boolean;
  onSeats(callback: (seats: readonly NetSeat[]) => void): () => void;
  onStart(callback: (start: NetStart) => void): () => void;
  /** Set this seat's room readiness; the room validates membership. */
  setReady(ready: boolean): void;
  /** Ask the room to start; the room validates the primary seat and readiness. */
  requestStart(): void;
  now(): NetTime;
  /** The tick-stamped frame this client holds for `seat`, if any. */
  frameFor(seat: number, tick: number): ActionFrame | undefined;
  /**
   * Per-seat authority only: a seeded stream. `'shared'` is the sequence every seat draws, a seat index is that
   * seat's public stream, and `'private'` is this seat's own — seeded from the room's per-seat `privateSeed`, never
   * derivable from the shared seed, and a `RangeError` when the room sent none.
   */
  rng(stream: 'shared' | 'private' | number): Rng;
  digest(): readonly number[];
}

export type NetTime = { serverMs: number; tick: number; offsetMs: number; rttMs: number; jitterMs: number };

export interface NetDiagnostics extends PerSeatDiagnostics {
  mode: AuthorityMode;
  dropped: number;
  eventGaps: number;
  outOfOrderSnapshots: number;
  stalls: number;
  oversized: number;
  /** How long the last event that arrived from the room waited before the game was handed it. 0 before the first. */
  eventDelayMs: number;
  /** Nearest-rank p95 of the last {@link EVENT_DELAY_SAMPLES} deliveries; 0 while the ring is empty. */
  eventDelayP95Ms: number;
  /** Bytes the codec refused, as well as the `oversized` count of refusals. */
  droppedBytes: number;
}

export interface NetControllerOptions {
  manifest: GameManifest;
  hooks: MultiplayerHooks;
  localPlayerIndex: number;
  send(type: string, payload: unknown): void;
  acceptInput(frame: ActionFrame): void;
  syncPlayers(players: ReadonlyArray<NetPlayer>): void;
  setLocalPlayerIndex(playerIndex: number): void;
  recordEvent(kind: string, payload: unknown): void;
  now(): number;
  warn?(message: string): void;
  /** Virtual-clock control for the start gate and drift resync; `boot` wires them to the runtime clock. */
  pauseClock?(): void;
  resumeClock?(): void;
  resetClock?(tick: number): void;
}

export interface NetController {
  readonly net: GmNet;
  readonly role: NetRole;
  readonly mode: AuthorityMode;
  /** `false` only for a host-mode peer: the one boolean that separates "renders" from "also simulates". */
  readonly stepLocally: boolean;
  readonly diagnostics: Readonly<NetDiagnostics>;
  /** `from` is the sending seat when the transport knows it; a `seat`-scope recovery answer is filtered for it. */
  handleMessage(type: string, payload: unknown, from?: number): void;
  handleLocalFrames(frames: ActionFrame[]): void;
  /** Per-seat authority: the local seat's sampled input, sent as it is sampled. */
  sampleLocal(frame: ActionFrame): void;
  beforeStep(tick: number, frames: ActionFrame[]): void;
  afterStep(tick: number): void;
  /** Evaluates the start gate; the runtime calls this before its clock advances (D-N2-12). */
  gate(nowMs?: number): void;
  render(): void;
  dispose(): void;
}

/** The v2 inbound names a per-seat controller handles. Host mode ignores them (routing is N3's). */
const V2_INBOUND = new Set([
  'net.start',
  'net.primary',
  'net.start.cancel',
  'net.epoch.end',
  'net.seats',
  'net.inputs',
  'net.state',
  'net.checksum',
  'net.recovery',
  'net.recovery.request',
  'net.tick',
  'net.clock',
]);

export function createNetController(options: NetControllerOptions): NetController {
  const mode = resolveAuthorityMode(options.manifest);
  if (mode === 'rollback') {
    throw new ModeMismatchError("authority mode 'rollback' is not implemented yet");
  }
  // A game that declares `view` is promised per-recipient payloads, and host authority packs one snapshot for every
  // peer (D-N5-3). Refusing here is the only honest answer: a silent downgrade would ship a game that believes it has
  // privacy it does not have.
  if (mode !== 'per-seat' && typeof (options.hooks as MultiplayerHooksV2).view === 'function') {
    throw new ModeMismatchError(
      `VISIBILITY_REQUIRES_PER_SEAT: net.view needs per-seat authority, this manifest declares '${mode}'`,
    );
  }

  const roles = new RoleStore(options.localPlayerIndex, options.hooks);
  const inputListeners = new Set<(playerIndex: number, frame: ActionFrame) => void>();
  const eventListeners = new Set<(event: unknown) => void>();
  const seatListeners = new Set<(seats: readonly NetSeat[]) => void>();
  const startListeners = new Set<(start: NetStart) => void>();
  const eventBuffer = new Map<number, unknown>();
  const warned = new Set<string>();
  const diagnostics: NetDiagnostics = {
    ...zeroDiagnostics(mode),
    dropped: 0,
    eventGaps: 0,
    outOfOrderSnapshots: 0,
    stalls: 0,
    oversized: 0,
    eventDelayMs: 0,
    eventDelayP95Ms: 0,
    droppedBytes: 0,
  };
  /* When each buffered event arrived from the room, so the delivery delay is measured in the event channel itself. */
  const eventArrivedAt = new Map<number, number>();
  const eventDelays = new EventDelayRing();
  /* Seats have already been spawned through the v1 hook, so a `net.seats` repeat does not spawn one twice. */
  const spawnedSeats = new Set<number>();
  let expectedEventSequence = 1;
  let outgoingEventSequence = 0;
  let eventGapStartedAt: number | undefined;
  let disposed = false;

  const perSeat = mode === 'per-seat' ? createPerSeatMode() : undefined;

  const oversized = (kind: 'input' | 'snapshot' | 'event', error: unknown) => {
    diagnostics.dropped += 1;
    diagnostics.oversized += 1;
    if (error instanceof NetPayloadTooLargeError) diagnostics.droppedBytes += error.byteLength;
    if (warned.has(kind)) return;
    warned.add(kind);
    (options.warn ?? console.warn)(`gm.net refused oversized ${kind} payload: ${String(error)}`);
  };
  const emitEvent = (event: unknown) => {
    for (const listener of eventListeners) listener(structuredClone(event));
  };

  const host = new HostChannel({
    actions: options.manifest.inputs.actions,
    hooks: options.hooks,
    role: () => roles.role,
    localPlayerIndex: () => roles.localPlayerIndex,
    playerCount: () => roles.players.length,
    send: (type, payload) => options.send(type, payload),
    acceptInput: options.acceptInput,
    emitInput: (playerIndex, frame) => {
      for (const listener of inputListeners) listener(playerIndex, structuredClone(frame));
    },
    oversized,
  });
  const peer = new PeerChannel({
    actions: options.manifest.inputs.actions,
    hooks: options.hooks,
    role: () => roles.role,
    localPlayerIndex: () => roles.localPlayerIndex,
    send: (type, payload) => options.send(type, payload),
    now: options.now,
    droppedSnapshot: () => {
      diagnostics.dropped += 1;
      diagnostics.outOfOrderSnapshots += 1;
    },
    invalidSnapshot: () => {
      diagnostics.dropped += 1;
    },
    stalled: () => {
      diagnostics.stalls += 1;
      const event = { type: 'net.stalled' };
      emitEvent(event);
      options.recordEvent('net.stalled', event);
    },
    oversized,
  });

  const syncState = () => {
    options.setLocalPlayerIndex(roles.localPlayerIndex);
    options.syncPlayers(roles.players);
  };
  const stopStateSync = roles.onStateChange(syncState);
  syncState();

  const net: GmNet & NetStateChanges = {
    get role() {
      return roles.role;
    },
    get localPlayerIndex() {
      return roles.localPlayerIndex;
    },
    get players() {
      return roles.players;
    },
    snapshotHz: 20,
    interpolationDelayMs: 100,
    get mode() {
      return mode;
    },
    get localSeat() {
      if (!perSeat) return roles.localPlayerIndex;
      return perSeat.spectator ? null : perSeat.localSeat;
    },
    get primarySeat() {
      return perSeat ? perSeat.currentPrimarySeat : null;
    },
    get seats() {
      return perSeat?.seatList ?? [];
    },
    get epoch() {
      return perSeat?.currentEpoch ?? '';
    },
    get tick() {
      return perSeat?.tick ?? 0;
    },
    get started() {
      return perSeat?.isStarted ?? false;
    },
    onSeats: (callback) => subscribe(seatListeners, callback),
    onStart: (callback) => subscribe(startListeners, callback),
    setReady: (ready) => {
      if (!disposed && perSeat) options.send('net.ready', { ready });
    },
    requestStart: () => {
      if (!disposed && perSeat) options.send('net.start.request', {});
    },
    now: () => ({
      serverMs: options.now() + (perSeat?.offsetMs ?? 0),
      tick: perSeat?.tick ?? 0,
      offsetMs: perSeat?.offsetMs ?? 0,
      rttMs: 0,
      jitterMs: 0,
    }),
    frameFor: (seat, tick) => perSeat?.frameFor(seat, tick),
    rng: (stream) => {
      if (!perSeat) throw new Error('gm.net streams are only available in per-seat authority');
      return perSeat.rng(stream);
    },
    digest: () => perSeat?.digest() ?? [],
    onPlayerJoined: (callback) => roles.onPlayerJoined(callback),
    onPlayerLeft: (callback) => roles.onPlayerLeft(callback),
    onInput: (callback) => subscribe(inputListeners, callback),
    onEvent: (callback) => subscribe(eventListeners, callback),
    sendEvent: (event) => {
      if (disposed) return;
      try {
        const bytes = packJson(event, NET_LIMITS.eventBytes, 'event');
        const data = encodeBase64(bytes);
        // Alone in the match there is nobody to send to; in per-seat authority the seat table, not the v1 roster,
        // says who is here.
        const playerCount = perSeat ? perSeat.seatList.filter((seat) => !seat.spectator).length : roles.players.length;
        if (playerCount === 1) {
          const decoded = unpackJson(bytes);
          emitEvent(decoded);
          options.recordEvent('net.event', decoded);
          return;
        }
        const seq = ++outgoingEventSequence;
        if (perSeat) {
          if (perSeat.spectator) return;
          options.send('net.event', {
            epoch: perSeat.isStarted ? perSeat.currentEpoch : 'lobby',
            id: `${perSeat.localSeat}-${seq}`,
            seq,
            from: perSeat.localSeat,
            target: 'all',
            data,
          });
        } else options.send('net.event', { seq, data });
      } catch (error) {
        if (error instanceof NetPayloadTooLargeError) oversized('event', error);
        else throw error;
      }
    },
    [NET_STATE_CHANGES]: (callback) => roles.onStateChange(callback),
  };

  return {
    net,
    get role() {
      return roles.role;
    },
    mode,
    get stepLocally() {
      return perSeat !== undefined || roles.role !== 'peer';
    },
    diagnostics,
    handleMessage(type, payload, from) {
      if (disposed) return;
      if (perSeat && V2_INBOUND.has(type)) {
        perSeat.handleMessage(type, payload, from);
        return;
      }
      if (type === 'net.players') {
        const message = payload as { local: number; players: NetPlayer[] };
        perSeat?.setLocalSeat(message.local);
        roles.updatePlayers(message.local, message.players);
      } else if (type === 'net.role') {
        const role = (payload as { role: NetRole }).role;
        roles.updateRole(role);
        if (role === 'peer') peer.enterPeer();
      } else if (type === 'net.input') {
        host.receiveInput((payload as { f: Parameters<HostChannel['receiveInput']>[0] }).f);
      } else if (type === 'net.snapshot') {
        peer.receiveSnapshot(payload as WireSnapshot);
      } else if (type === 'net.event') {
        if (perSeat && typeof payload === 'object' && payload !== null && 'from' in payload) {
          /* The room relays over one ordered socket and never replays, and a reloaded seat restarts at 1. */
          const event = payload as { from: number; data: string };
          try {
            const bytes = decodeBase64(event.data);
            assertByteLength(bytes, NET_LIMITS.eventBytes, 'event');
            const decoded = unpackJson(bytes);
            emitEvent(decoded);
            options.recordEvent('net.event', decoded);
          } catch {
            diagnostics.dropped += 1;
          }
        } else receiveEvent(payload as { seq: number; data: string });
      }
    },
    handleLocalFrames: (frames) => {
      if (!perSeat) peer.sendFrames(frames);
    },
    sampleLocal: (frame) => perSeat?.sampleLocal(frame),
    beforeStep: (tick, frames) => perSeat?.beforeStep(tick, frames),
    afterStep: (tick) => {
      if (perSeat) perSeat.afterStep(tick);
      else host.afterStep(tick);
    },
    gate: (nowMs) => {
      perSeat?.gateOpen(nowMs);
    },
    render() {
      if (perSeat) perSeat.render();
      else peer.render();
      advanceEventGap();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopStateSync();
      roles.dispose();
      perSeat?.dispose();
      inputListeners.clear();
      eventListeners.clear();
      seatListeners.clear();
      startListeners.clear();
      eventBuffer.clear();
      eventArrivedAt.clear();
    },
  };

  /**
   * A seat is a player. The v1 hooks (`spawn`/`despawn`) stay the one way a game learns that somebody joined — the design
   * keeps them for every existing template — so a per-seat match fires them from the seat table, exactly as the v1 path
   * fires them from `net.players`. Two things are deliberately not spawned:
   *
   * - this client's own seat, which the game created when it built its world (`createSimulation`) and whose `spawn`
   *   would put its avatar back at its start point mid-match, at a moment that differs per client and desyncs the room;
   * - a seat already spawned from an earlier table, so a repeated broadcast is not a second spawn.
   */
  function syncSeatedPlayers(seats: readonly NetSeat[]): void {
    const seated = new Set(
      seats.filter((seat) => seat.userId !== '' && !seat.forfeited && !seat.spectator).map((seat) => seat.seat),
    );
    for (const seat of seated) {
      if (seat === roles.localPlayerIndex) continue;
      if (spawnedSeats.has(seat)) continue;
      options.hooks.spawn(seat, playerId(seat));
      spawnedSeats.add(seat);
    }
    for (const seat of [...spawnedSeats]) {
      if (seated.has(seat)) continue;
      options.hooks.despawn(playerId(seat));
      spawnedSeats.delete(seat);
    }
  }

  function createPerSeatMode(): PerSeatMode {
    const hooks = options.hooks as MultiplayerHooksV2;
    if (!hooks.capture || !hooks.restore || !hooks.digest) {
      throw new ModeMismatchError("authority mode 'per-seat' requires net.capture, net.restore and net.digest");
    }
    return new PerSeatMode({
      manifest: options.manifest,
      hooks,
      localSeat: options.localPlayerIndex,
      diagnostics,
      send: (type, payload) => options.send(type, payload),
      now: options.now,
      pauseClock: () => options.pauseClock?.(),
      resumeClock: () => options.resumeClock?.(),
      resetClock: (tick) => options.resetClock?.(tick),
      recordEvent: options.recordEvent,
      emitSeats: (seats) => {
        syncSeatedPlayers(seats);
        for (const listener of seatListeners) listener(seats);
      },
      emitStart: (start) => {
        for (const listener of startListeners) listener(start);
      },
      warn: options.warn,
    });
  }

  function receiveEvent(message: { seq: number; data: string }): void {
    if (message.seq < expectedEventSequence || eventBuffer.has(message.seq)) return;
    try {
      const bytes = decodeBase64(message.data);
      assertByteLength(bytes, NET_LIMITS.eventBytes, 'event');
      eventBuffer.set(message.seq, unpackJson(bytes));
      eventArrivedAt.set(message.seq, options.now());
    } catch (error) {
      if (error instanceof NetPayloadTooLargeError) oversized('event', error);
      else diagnostics.dropped += 1;
      return;
    }

    deliverAvailableEvents();
  }

  function deliverAvailableEvents(): void {
    while (eventBuffer.has(expectedEventSequence)) {
      const event = eventBuffer.get(expectedEventSequence);
      eventBuffer.delete(expectedEventSequence);
      const arrivedAt = eventArrivedAt.get(expectedEventSequence);
      eventArrivedAt.delete(expectedEventSequence);
      if (arrivedAt !== undefined) eventDelays.add(options.now() - arrivedAt);
      diagnostics.eventDelayMs = eventDelays.latest;
      diagnostics.eventDelayP95Ms = eventDelays.p95;
      emitEvent(event);
      options.recordEvent('net.event', event);
      expectedEventSequence += 1;
    }
    eventGapStartedAt = eventBuffer.size === 0 ? undefined : (eventGapStartedAt ?? options.now());
  }

  function advanceEventGap(): void {
    if (eventGapStartedAt === undefined || options.now() - eventGapStartedAt < 2_000) return;
    const nextSequence = Math.min(...eventBuffer.keys());
    if (!Number.isFinite(nextSequence)) return;
    diagnostics.eventGaps += 1;
    expectedEventSequence = nextSequence;
    eventGapStartedAt = undefined;
    deliverAvailableEvents();
  }
}

function zeroDiagnostics(
  mode: AuthorityMode,
): Omit<NetDiagnostics, 'dropped' | 'eventGaps' | 'oversized' | 'eventDelayMs' | 'eventDelayP95Ms' | 'droppedBytes'> {
  return {
    mode,
    epoch: '',
    tick: 0,
    lateStartTicks: 0,
    inputDelayTicks: 0,
    inputGaps: 0,
    lateInputs: 0,
    localResponseMs: 0,
    remoteUpdateMs: 0,
    clockOffsetMs: 0,
    clockResyncs: 0,
    desyncs: 0,
    recoveries: 0,
    hardResyncs: 0,
    desynced: false,
    outOfOrderSnapshots: 0,
    stalls: 0,
  };
}

function subscribe<T>(listeners: Set<T>, callback: T): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export { type NetPlayer, type NetRole } from './roles.js';
export { interpolateState } from './peer.js';
export { bindLocalPlayer, type LocalPlayerBindingOptions } from './bind.js';
export { ModeMismatchError, resolveAuthorityMode } from './mode.js';
export { PerSeatMode } from './modes/per-seat.js';
export { DIGEST_SCALE, fold, sameWords, sortedIds, toUnits } from './foundations/checksum.js';
export { createStreams, type Streams } from './foundations/streams.js';
