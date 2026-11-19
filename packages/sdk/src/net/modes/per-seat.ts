import type {
  ActionFrame,
  GameManifest,
  InputFrame,
  MultiplayerHooksV2,
  NetSeat,
  NetStart,
  Snapshot,
} from '@ogm/contracts';

import type { Rng } from '../../core/rng.js';
import { decodeBase64, encodeBase64, packJson, unpackJson } from '../codec.js';
import { decodeInputFrame, encodeInputFrame } from '../input-codec.js';
import { interpolateState } from '../peer.js';
import { ClockSync, StartGate, type ClockSample } from '../foundations/clock-sync.js';
import { fold } from '../foundations/checksum.js';
import { RecoveryBook, type RecoveryScope } from '../foundations/recovery.js';
import { createStreams, type Streams } from '../foundations/streams.js';
import { encodeSeatState, payloadFor, SEAT_STATE_BUDGET, type VisibilityOptions } from '../visibility.js';
import {
  DEFAULT_INPUT_DELAY_TICKS,
  InputRings,
  MAX_INPUT_DELAY_TICKS,
  MIN_INPUT_DELAY_TICKS,
} from '../foundations/tick-inputs.js';

/**
 * Per-seat authority (design §3.2). Every seat runs the whole simulation at the fixed step and applies its own input
 * in the same tick it is sampled; other seats are reconstructed from tick-stamped redundant inputs, corrected by the
 * owner's published state, and proven by a shared checksum that a recovery snapshot settles.
 *
 * Nothing here reads ambient time or randomness: `options.now()` is the only clock and every draw comes from the
 * seeded streams, because `src/test/no-random.test.ts` scans this directory.
 */

/* Literals rather than a value import from `@ogm/contracts`: the package root re-exports every contract family, so
 * importing one number from it pulls the whole index — including modules that read `node:fs` — into a template's
 * browser bundle and breaks its production build. `codec.test.ts` asserts these stay equal to the contract's. */
export { SEAT_STATE_BUDGET };
export const RECOVERY_BUDGET = 65_536;
export const DEFAULT_SEAT_STATE_HZ = 10;
export const CHECKSUM_EVERY_TICKS = 30;
export const CORRECTION_MS = 120;
export const RESYNC_AFTER_GAP_TICKS = 30;

export interface PerSeatDiagnostics {
  epoch: string;
  tick: number;
  lateStartTicks: number;
  inputDelayTicks: number;
  inputGaps: number;
  lateInputs: number;
  localResponseMs: number;
  remoteUpdateMs: number;
  clockOffsetMs: number;
  clockResyncs: number;
  desyncs: number;
  recoveries: number;
  hardResyncs: number;
  desynced: boolean;
  outOfOrderSnapshots: number;
  dropped: number;
  oversized: number;
}

export interface PerSeatModeOptions {
  manifest: GameManifest;
  hooks: MultiplayerHooksV2;
  localSeat: number;
  diagnostics: PerSeatDiagnostics;
  send(type: string, payload: unknown): void;
  now(): number;
  pauseClock(): void;
  resumeClock(): void;
  resetClock(tick: number): void;
  recordEvent(kind: string, payload: unknown): void;
  emitSeats(seats: readonly NetSeat[]): void;
  emitStart(start: NetStart): void;
  warn?(message: string): void;
}

interface PendingCorrection {
  previous: unknown;
  next: unknown;
  startedAtMs: number;
}

export class PerSeatMode {
  localSeat: number;
  private readonly rings: InputRings;
  private readonly clock = new ClockSync();
  private readonly gate: StartGate;
  private readonly recovery = new RecoveryBook();
  private readonly sums = new Map<number, number>();
  private readonly remoteSums = new Map<number, number>();
  private readonly corrections = new Map<number, PendingCorrection>();
  private readonly lastAccepted = new Map<number, number>();
  private readonly consecutiveGaps = new Map<number, number>();
  private readonly sampledTicks = new Set<number>();
  private readonly pendingStates = new Map<number, { tick: number; state: unknown }[]>();
  private seats: NetSeat[];
  private epoch = '';
  private currentTick = 0;
  private inputSequence = 0;
  private stateSequence = 0;
  private lastRemoteUpdateMs = 0;
  private streams: Streams | undefined;
  private stateEveryTicks: number;
  private inputDelayTicks: number;
  private started = false;
  private warnings = 0;
  private readonly warned = new Set<string>();
  private disposed = false;

  constructor(private readonly options: PerSeatModeOptions) {
    this.localSeat = options.localSeat;
    this.seats = [seatRecord(options.localSeat)];
    this.inputDelayTicks = clampDelay(options.manifest.net?.inputDelayTicks ?? DEFAULT_INPUT_DELAY_TICKS);
    this.stateEveryTicks = Math.max(1, Math.round(60 / (options.manifest.net?.seatStateHz ?? DEFAULT_SEAT_STATE_HZ)));
    this.rings = new InputRings({ seats: [options.localSeat] });
    this.gate = new StartGate({
      resetClock: (tick) => options.resetClock(tick),
      pauseClock: () => options.pauseClock(),
      resumeClock: () => options.resumeClock(),
    });
    options.diagnostics.inputDelayTicks = this.inputDelayTicks;
    this.syncDiagnostics();
  }

  get mode(): 'per-seat' {
    return 'per-seat';
  }

  setLocalSeat(seat: number): void {
    if (this.started && seat !== this.localSeat) throw new Error('local seat cannot change during an epoch');
    this.localSeat = seat;
  }

  get tick(): number {
    return this.currentTick;
  }

  get currentEpoch(): string {
    return this.epoch;
  }

  get isStarted(): boolean {
    return this.started;
  }

  rng(stream: 'shared' | 'private' | number): Rng {
    if (!this.streams) throw new Error('gm.net streams are unavailable before net.start');
    if (stream === 'shared') return this.streams.shared();
    if (stream === 'private') return this.streams.private();
    return this.streams.seat(stream);
  }

  /** True when this client holds no seat: it receives state but never publishes or answers a recovery. */
  get spectator(): boolean {
    return this.seats.find((seat) => seat.seat === this.localSeat)?.spectator === true;
  }

  get seatList(): readonly NetSeat[] {
    return this.seats;
  }

  digest(): readonly number[] {
    return this.options.hooks.digest?.() ?? [];
  }

  /** The start gate, called from `RuntimeImpl.advance` before the clock moves (D-N2-12). */
  gateOpen(nowMs?: number): boolean {
    return this.gate.evaluate(this.clock.serverMs(nowMs ?? this.options.now()));
  }

  /** The tick-stamped frame this client holds for `seat`, decoded for the game. */
  frameFor(seat: number, tick: number): ActionFrame | undefined {
    const frame = this.rings.frameFor(seat, tick);
    return frame ? decodeInputFrame(stamped(frame), this.options.manifest.inputs.actions) : undefined;
  }

  /**
   * The local seat's input for `frame.tick`, sampled and put on the wire straight away.
   *
   * A client samples at real time and simulates `inputDelayTicks` later, which is what lets every other seat
   * reconstruct the tick before it is stepped; sending during the step would always be one latency late.
   */
  sampleLocal(frame: ActionFrame): void {
    if (this.disposed || !this.started || frame.playerIndex !== this.localSeat) return;
    const encoded = encodeInputFrame(frame, this.options.manifest.inputs.actions, ++this.inputSequence);
    this.rings.record({ ...encoded, seat: this.localSeat });
    this.sampledTicks.add(frame.tick);
    for (const sampled of this.sampledTicks) {
      if (sampled < frame.tick - 240) this.sampledTicks.delete(sampled);
    }
    if (frame.tick % this.rings.cadenceTicks === 0) this.sendInputs(frame.tick);
  }

  /** Frames per seat for this step: the local seat's own frame plus one per other seat. */
  beforeStep(tick: number, frames: ActionFrame[]): void {
    if (this.disposed) return;
    this.currentTick = tick;
    this.gateOpen();
    if (!this.started) return;

    const local = frames.find((frame) => frame.playerIndex === this.localSeat);
    if (local && !this.sampledTicks.has(tick)) this.sampleLocal(local);
    if (!local) {
      // A caller that samples ahead (the loopback harness, a room-driven client) hands over remote frames only; the
      // local seat's own frame is still applied in its own tick.
      const own = this.rings.frameFor(this.localSeat, tick);
      if (own) frames.push(decodeInputFrame(stamped(own), this.options.manifest.inputs.actions));
    }

    for (const seat of this.seats) {
      if (seat.seat === this.localSeat) continue;
      const collected = this.rings.collect(seat.seat, tick);
      const gaps = collected.gapped ? (this.consecutiveGaps.get(seat.seat) ?? 0) + 1 : 0;
      this.consecutiveGaps.set(seat.seat, gaps);
      if (collected.gapped && gaps > RESYNC_AFTER_GAP_TICKS) this.requestRecovery('seat', tick, seat.seat);
      if (!collected.frame) continue;
      frames.push(decodeInputFrame(stamped(collected.frame), this.options.manifest.inputs.actions));
    }

    this.syncDiagnostics();
  }

  afterStep(tick: number): void {
    if (this.disposed || !this.started) return;
    this.currentTick = tick;
    for (const seat of this.seats) this.rings.markSimulated(seat.seat, tick);

    // A slice published at tick T is the owner's state *after* T, so it is applied after this seat's own step of T:
    // applying it any earlier would leave the receiver one move ahead of the owner, or one behind.
    this.applyPublishedStates(tick);
    if (tick % this.stateEveryTicks === 0) this.publishState(tick);
    if (tick % CHECKSUM_EVERY_TICKS === 0) this.publishChecksum(tick);
    this.syncDiagnostics();
  }

  /**
   * Reconciliation: a slice with the interpolatable `entities[id].p/r` shape blends over `CORRECTION_MS`, anything
   * else has already snapped when it was applied. Blending a flat slice would pin it over the step for the whole
   * correction window.
   */
  render(): void {
    if (this.disposed) return;
    const nowMs = this.options.now();
    for (const [seat, correction] of this.corrections) {
      const amount = CORRECTION_MS <= 0 ? 1 : Math.min(1, (nowMs - correction.startedAtMs) / CORRECTION_MS);
      if (amount >= 1) {
        this.corrections.delete(seat);
        this.options.hooks.restore?.({ tick: this.currentTick, state: correction.next });
        continue;
      }
      this.options.hooks.restore?.({
        tick: this.currentTick,
        state: interpolateState(correction.previous, correction.next, amount),
      });
    }
  }

  private correctionFor(previous: unknown, next: unknown): PendingCorrection {
    return { previous, next, startedAtMs: this.options.now() };
  }

  handleMessage(type: string, payload: unknown, from?: number): void {
    if (this.disposed) return;
    if (type === 'net.clock') {
      this.sampleClock(payload as ClockSample);
      return;
    }
    if (type === 'net.start') {
      this.start(payload as NetStart);
      return;
    }
    if (type === 'net.start.cancel' || type === 'net.epoch.end') {
      this.gate.cancel();
      this.started = false;
      this.syncDiagnostics();
      return;
    }
    if (type === 'net.seats') {
      this.setSeats((payload as { seats: NetSeat[] }).seats);
      return;
    }
    if (!this.started) return;

    if (type === 'net.inputs') {
      this.receiveInputs(payload as { epoch: string; seat: number; firstTick: number; frames: InputFrame[] });
      return;
    }
    if (type === 'net.state') {
      this.receiveState(payload as { epoch: string; seat: number; seq: number; tick: number; data: string });
      return;
    }
    if (type === 'net.checksum') {
      this.receiveChecksum(payload as { epoch: string; scope: 'shared' | 'seat'; tick: number; sum: number });
      return;
    }
    if (type === 'net.recovery.request') {
      this.answerRecovery(payload as { scope: RecoveryScope; tick: number; seat?: number }, from);
      return;
    }
    if (type === 'net.recovery') {
      this.applyRecovery(payload as { scope: RecoveryScope; tick: number; to?: number; snapshot?: string });
      return;
    }
    if (type === 'net.tick') {
      this.receiveTick((payload as { tick: number }).tick);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.rings.dispose();
    this.sampledTicks.clear();
    this.pendingStates.clear();
    this.corrections.clear();
    this.sums.clear();
    this.remoteSums.clear();
    this.warned.clear();
  }

  private start(start: NetStart): void {
    if (this.started && this.epoch === start.epoch) {
      this.setSeats(start.seats);
      return;
    }
    this.epoch = start.epoch;
    this.seats = [...start.seats];
    this.streams = createStreams(start.seed, start.privateSeed ?? 0);
    this.rings.setSeats(this.seats.map((seat) => seat.seat));
    this.recovery.reset();
    this.sums.clear();
    this.remoteSums.clear();
    this.lastAccepted.clear();
    this.consecutiveGaps.clear();
    this.sampledTicks.clear();
    this.pendingStates.clear();
    this.options.emitSeats(this.seats);
    this.options.emitStart(start);

    const local = start.seats.find((seat) => seat.seat === this.localSeat);
    if (local === undefined) throw new Error(`net.start has no room for seat ${this.localSeat}`);

    this.started = true;
    this.gate.arm(start.startAt);
    const serverMs = this.clock.serverMs(this.options.now());
    if (serverMs >= start.startAt) {
      const lateTicks = this.clock.tickAt(serverMs, start.startAt);
      this.options.diagnostics.lateStartTicks = lateTicks;
      this.gate.skipTo(lateTicks);
      this.currentTick = lateTicks;
    }
    this.syncDiagnostics();
  }

  private setSeats(seats: readonly NetSeat[]): void {
    this.seats = [...seats];
    this.rings.setSeats(this.seats.map((seat) => seat.seat));
    this.options.emitSeats(this.seats);
  }

  private sendInputs(tick: number): void {
    const frames = this.rings.window(this.localSeat, tick);
    if (frames.length === 0) return;
    try {
      this.options.send('net.inputs', {
        epoch: this.epoch,
        seat: this.localSeat,
        firstTick: frames[0]!.tick,
        frames: frames.map(({ seq, tick, axes, buttons }) => ({ seq, tick, axes, buttons })),
      });
    } catch (error) {
      this.drop('inputs', error);
    }
  }

  /**
   * Publish this seat's owned state. With `view` implemented this is one encode per recipient, each addressed with
   * `to` so the room unicasts it; without `view` it stays the single broadcast N2 shipped.
   */
  private publishState(tick: number): void {
    if (this.spectator) return;
    let batch;
    try {
      batch = encodeSeatState(this.visibility(), { epoch: this.epoch, tick, seq: ++this.stateSequence });
    } catch (error) {
      this.drop('state', error);
      return;
    }
    this.options.diagnostics.dropped += batch.failures;
    this.options.diagnostics.oversized += batch.oversized;
    for (const message of batch.messages) {
      try {
        this.options.send('net.state', message);
      } catch (error) {
        this.drop('state', error);
        return;
      }
    }
  }

  /** The visibility contract, with warn-once per kind for the whole match (a per-frame warning is a log flood). */
  private visibility(): VisibilityOptions {
    return {
      hooks: this.options.hooks,
      localSeat: this.localSeat,
      recipients: () =>
        this.seats.filter((seat) => seat.seat !== this.localSeat && !seat.spectator).map((seat) => seat.seat),
      warn: (kind, message) => this.warnOnce(kind, message),
    };
  }

  private warnOnce(kind: string, message: string): void {
    if (this.warned.has(kind)) return;
    this.warned.add(kind);
    (this.options.warn ?? console.warn)(message);
  }

  private publishChecksum(tick: number): void {
    const sum = fold(this.digest());
    this.sums.set(tick, sum);
    this.pruneSums(tick);
    this.options.send('net.checksum', { epoch: this.epoch, scope: 'shared', tick, sum });

    // A peer's sum for this tick usually arrives before we simulate it, so the comparison happens here as well
    // as on receipt.
    const remote = this.remoteSums.get(tick);
    if (remote !== undefined && remote !== sum) this.mismatch(tick);
  }

  private receiveInputs(message: { epoch: string; seat: number; firstTick: number; frames: InputFrame[] }): void {
    if (message.epoch !== this.epoch || message.seat === this.localSeat) return;
    for (const frame of message.frames) this.rings.record({ ...frame, seat: message.seat });
  }

  private receiveState(message: {
    epoch: string;
    seat: number;
    seq: number;
    tick: number;
    to?: number;
    data: string;
  }): void {
    if (message.epoch !== this.epoch || message.seat === this.localSeat) return;
    // An addressed publish is one recipient's filtered copy. A room that broadcast it anyway must not hand seat A
    // the slice that was narrowed for seat B — that is the exact data `view` removed.
    if (message.to !== undefined && message.to !== this.localSeat) return;
    const last = this.lastAccepted.get(message.seat);
    if (last !== undefined && message.tick < last) {
      this.options.diagnostics.outOfOrderSnapshots += 1;
      this.syncDiagnostics();
      return;
    }
    let snapshot: Snapshot;
    try {
      snapshot = unpackJson<Snapshot>(decodeBase64(message.data));
    } catch (error) {
      this.drop('state', error);
      return;
    }
    this.lastAccepted.set(message.seat, message.tick);
    this.lastRemoteUpdateMs = this.options.now();
    // A published state is applied when the local simulation reaches its tick, never on arrival: applying a tick-6
    // slice while stepping tick 4 would clobber ticks the ring is about to replay.
    const pending = this.pendingStates.get(message.seat) ?? [];
    pending.push({ tick: snapshot.tick, state: snapshot.state });
    while (pending.length > 8) pending.shift();
    this.pendingStates.set(message.seat, pending);
    this.syncDiagnostics();
  }

  /** Applies the newest published slice for every other seat whose tick the local simulation has reached. */
  private applyPublishedStates(tick: number): void {
    for (const [seat, pending] of this.pendingStates) {
      let newest: { tick: number; state: unknown } | undefined;
      while (pending.length > 0 && pending[0]!.tick <= tick) {
        const candidate = pending.shift()!;
        if (candidate.tick >= tick) newest = candidate;
      }
      if (!newest) continue;
      const previous = this.options.hooks.capture?.({ seat })?.state;
      this.options.hooks.restore?.({ tick: newest.tick, state: newest.state });
      if (hasEntities(newest.state)) this.corrections.set(seat, this.correctionFor(previous, newest.state));
    }
  }

  private receiveChecksum(message: { epoch: string; scope: 'shared' | 'seat'; tick: number; sum: number }): void {
    if (message.epoch !== this.epoch || message.scope !== 'shared') return;
    const local = this.sums.get(message.tick);
    if (local === undefined) {
      this.remoteSums.set(message.tick, message.sum);
      this.pruneSums(this.currentTick);
      return;
    }
    if (local === message.sum) return;
    this.mismatch(message.tick);
  }

  /**
   * A shared sum disagrees. The primary is the arbiter, so it records the disagreement and answers the request the
   * other seat sends; a non-primary seat asks for the primary's snapshot.
   */
  private mismatch(tick: number): void {
    this.options.diagnostics.desyncs += 1;
    if (this.primarySeat() === this.localSeat) return;
    this.requestRecovery('shared', tick);
  }

  private pruneSums(newest: number): void {
    const oldest = newest - 120;
    for (const key of this.sums.keys()) if (key < oldest) this.sums.delete(key);
    for (const key of this.remoteSums.keys()) if (key < oldest) this.remoteSums.delete(key);
  }

  /**
   * The arbiter answers with the state the checksum covered. A shared disagreement is about the whole state — the
   * shared sum folds every seat's words — so a shared answer is one slice per scope: the shared state and each seat's
   * owned state, each applied by `restore` exactly as given (D-N2-6).
   */
  private answerRecovery(message: { scope: RecoveryScope; tick: number; seat?: number }, from?: number): void {
    if (this.spectator) return;
    if (message.scope !== 'shared' && this.primarySeat() !== this.localSeat && message.seat !== this.localSeat) return;
    if (message.scope === 'shared' && this.primarySeat() !== this.localSeat) return;

    const slices: { scope: RecoveryScope; seat?: number; snapshot: Snapshot; to?: number }[] = [];
    if (message.scope === 'seat') {
      const seat = message.seat ?? this.localSeat;
      const snapshot = this.recoverySlice(seat, from);
      if (snapshot) slices.push({ scope: 'seat', seat, snapshot, ...(from === undefined ? {} : { to: from }) });
    } else if (message.scope === 'shared') {
      const shared = this.options.hooks.capture?.({});
      if (shared) slices.push({ scope: 'shared', snapshot: shared });
      // A shared answer is the one state payload that is deliberately not filtered (D-N5-4): a filtered shared truth
      // would give two recipients two different worlds while the checksum still compared them. The per-seat slices it
      // bundles are another matter — they are other seats' owned state, so a game with `view` does not ship them and
      // the requester keeps its own reconstruction instead (§3.9 limit 5).
      if (typeof this.options.hooks.view !== 'function') {
        for (const seat of this.seats) {
          const snapshot = this.options.hooks.capture?.({ seat: seat.seat });
          if (snapshot) slices.push({ scope: 'seat', seat: seat.seat, snapshot });
        }
      }
    }
    if (slices.length === 0) return;

    try {
      for (const slice of slices) {
        this.options.send('net.recovery', {
          epoch: this.epoch,
          scope: slice.scope,
          tick: message.tick,
          ...(slice.seat === undefined ? {} : { seat: slice.seat }),
          ...(slice.to === undefined ? {} : { to: slice.to }),
          snapshot: encodeBase64(packJson(slice.snapshot, RECOVERY_BUDGET, 'recovery')),
        });
      }
    } catch (error) {
      this.drop('recovery', error);
    }
  }

  /**
   * A `seat`-scope snapshot as the requester may receive it (D-N5-4). A game without `view` gets the raw slice it
   * always got; with `view`, only the slice's owner can say what a recipient may have, and it says it through
   * `view(requester)` — an answer computed any other way would be exactly the copy `view` removed.
   */
  private recoverySlice(subject: number, requester: number | undefined): Snapshot | undefined {
    if (typeof this.options.hooks.view !== 'function') return this.options.hooks.capture?.({ seat: subject });
    if (subject !== this.localSeat) {
      this.options.diagnostics.dropped += 1;
      this.warnOnce('view', `gm.net refused a seat ${subject} recovery answer: only its owner can filter it`);
      return undefined;
    }
    if (requester === undefined) {
      this.options.diagnostics.dropped += 1;
      this.warnOnce(
        'view',
        'gm.net refused a seat recovery answer: the requesting seat is unknown, so it cannot be filtered',
      );
      return undefined;
    }
    return payloadFor(this.visibility(), requester);
  }

  private applyRecovery(message: { scope: RecoveryScope; tick: number; to?: number; snapshot?: string }): void {
    if (message.to !== undefined && message.to !== this.localSeat) return;
    if (message.scope === 'shared' && this.primarySeat() === this.localSeat) return;
    this.recovery.settle(message.scope);
    const plan = this.recovery.plan(message.tick, this.currentTick);
    if (plan.mode === 'hard') this.recovery.recordResync(this.options.now());
    if (message.snapshot === undefined) {
      this.syncDiagnostics();
      return;
    }
    let snapshot: Snapshot;
    try {
      snapshot = unpackJson<Snapshot>(decodeBase64(message.snapshot));
    } catch (error) {
      this.drop('recovery', error);
      return;
    }
    const previous = this.options.hooks.capture?.({})?.state;
    this.options.hooks.restore?.({ tick: snapshot.tick, state: snapshot.state });
    if (hasEntities(snapshot.state)) this.corrections.set(this.localSeat, this.correctionFor(previous, snapshot.state));
    this.syncDiagnostics();
  }

  private receiveTick(roomTick: number): void {
    const decision = this.clock.drift(roomTick, this.currentTick);
    if (!decision.resync) return;
    this.options.diagnostics.clockResyncs += 1;
    this.options.resetClock(decision.roomTick);
    this.currentTick = decision.roomTick;
    this.syncDiagnostics();
  }

  private requestRecovery(scope: RecoveryScope, tick: number, seat?: number): void {
    const request = this.recovery.request(scope, tick, this.options.now(), seat);
    if (!request) return;
    try {
      this.options.send('net.recovery.request', {
        epoch: this.epoch,
        scope: request.scope,
        tick: request.tick,
        ...(request.seat === undefined ? {} : { seat: request.seat }),
      });
    } catch (error) {
      this.drop('recovery', error);
    }
    this.syncDiagnostics();
  }

  private primarySeat(): number {
    const primary = this.seats.find((seat) => seat.connected && seat.seat === 0);
    return primary?.seat ?? this.seats[0]?.seat ?? 0;
  }

  private drop(label: string, error: unknown): void {
    this.options.diagnostics.dropped += 1;
    if (this.warnings > 0) return;
    this.warnings += 1;
    (this.options.warn ?? console.warn)(`gm.net dropped an oversized ${label} payload: ${String(error)}`);
  }

  private syncDiagnostics(): void {
    const diagnostics = this.options.diagnostics;
    diagnostics.epoch = this.epoch;
    diagnostics.tick = this.currentTick;
    diagnostics.inputGaps = this.rings.inputGaps;
    diagnostics.lateInputs = this.rings.lateInputs;
    diagnostics.clockOffsetMs = this.clock.offsetMs;
    diagnostics.localResponseMs = 0;
    diagnostics.remoteUpdateMs =
      this.lastRemoteUpdateMs === 0 ? 0 : Math.max(0, Math.round(this.options.now() - this.lastRemoteUpdateMs));
    diagnostics.recoveries = this.recovery.recoveries;
    diagnostics.hardResyncs = this.recovery.hardResyncs;
    diagnostics.desynced = this.recovery.desynced;
  }

  /** Feeds a scripted clock sample in; the loopback harness and the room's `pong` both land here. */
  sampleClock(sample: ClockSample): void {
    this.clock.sample(sample);
    this.syncDiagnostics();
  }

  /** The offset the last clock sample settled on. */
  get offsetMs(): number {
    return this.clock.offsetMs;
  }
}

/** Only the documented `entities[id].p/r` shape is interpolatable; every other slice snaps. */
function hasEntities(state: unknown): boolean {
  if (typeof state !== 'object' || state === null) return false;
  const entities = (state as { entities?: unknown }).entities;
  return typeof entities === 'object' && entities !== null;
}

function clampDelay(value: number): number {
  return Math.min(MAX_INPUT_DELAY_TICKS, Math.max(MIN_INPUT_DELAY_TICKS, Math.round(value)));
}

function stamped(frame: InputFrame & { seat: number }): InputFrame & { playerIndex: number } {
  return { seq: frame.seq, tick: frame.tick, axes: frame.axes, buttons: frame.buttons, playerIndex: frame.seat };
}

function seatRecord(seat: number): NetSeat {
  return {
    seat,
    userId: `local-${seat}`,
    name: `Player ${seat + 1}`,
    team: 0,
    connected: true,
    ready: true,
    forfeited: false,
    spectator: false,
  };
}
