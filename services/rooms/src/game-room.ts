import { CloseCode, Room, ServerError, type Client } from '@colyseus/core';
import {
  JoinOptionsSchema,
  LIMITS,
  LIMITS_V2,
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_V1,
  SIM_TICK_HZ,
  PresenceSchema as ContractPresenceSchema,
  RoomClientMessageSchema,
  type NetClientMessage,
  type RoomClientMessage,
  type RoomGrant,
  type RoomStateV2,
  type TeamPolicy,
} from '@ogm/contracts';
import { RateTable, validateDesignTx, validateInputFrame, verifyGrant, zeroPrivatePresence } from '@ogm/room-protocol';

import { canStart, mintEpoch, pauseAt, privateSeedFor, resumeAt, tickAt } from './epoch.js';
import { type EndReason, postEnded, roomTimings, type RoomTimings } from './lifecycle.js';
import { recordDropped } from './metrics.js';
import { type DropCode, type SeatRecord, recipientsFor } from './routing.js';
import {
  bindUser,
  electPrimary,
  forfeit,
  freeSeat,
  isFree,
  lowestFreeSeat,
  markOffline,
  markOnline,
  releaseForfeited,
  seatOfUser,
  seatsSnapshot,
  syncMembersFromSeats,
  teamOf,
} from './seats.js';
import {
  DraftState,
  GameRoomState,
  MembershipState,
  type SeatState,
  createRoomState,
  roomStateJson,
  setPresence,
} from './state.js';

const liveRooms = new Map<string, GameRoom>();
/** How long a probed seat may stay silent before the pause falls back to the room's tick (no SDK answers slower). */
const MATCH_PROBE_TIMEOUT_MS = 2_000;
/** How far short of a prepared boundary a joining seat starts, so it reaches the boundary by running forward. */
const PREPARED_JOIN_MARGIN_MS = 1_000;

export type RuntimeOptions = {
  grantSecret: string;
  internalSecret: string;
  apiInternalUrl: string;
  gamesOrigin: string;
  timings: RoomTimings;
  fetchFn: typeof fetch;
};

export type GameRoomOptions = {
  gameId: string;
  branchId: string;
  buildId: string;
  ownerId: string;
  maxPlayers: number;
  /** `1` = the v1 editor relay; `2` = seats, teams, epochs and routing (#497 §4.2). Default 1. */
  protocol?: 1 | 2;
  /** Teams: `'none'` (every seat team 0) or `'alternate'` (seat n → team n % 2). */
  teams?: TeamPolicy;
  /** `'on'` admits a join past `maxPlayers` as a spectator with no seat and no authority. */
  spectators?: 'off' | 'on';
  /** Pause the epoch for every seat while a seat's rejoin window is open. Default true. */
  pauseOnDisconnect?: boolean;
  /** Opaque client-computed ruleset pin; `''` disables the join comparison. */
  rulesetHash?: string;
  /** N1's `AuthorityMode`, relayed to clients in `net.start` as an opaque string. Default `'host'`. */
  mode?: string;
  /** Test seam for the fixed start lead; clamped to 500..5000 ms. */
  startLeadMs?: number;
  timings?: Partial<RoomTimings>;
  runtime?: RuntimeOptions;
};

type ForcedLeave = 'kick' | 'rate' | 'revoked';
type ViolationWindow = { count: number; startedAt: number };

const RATE_LIMITS = {
  input: 60,
  snapshot: LIMITS.snapshotPerSec,
  event: LIMITS.eventPerSec,
  'design.tx': LIMITS.designTxPerSec,
  presence: LIMITS.presencePerSec,
  phase: 10,
  'draft.load': 5,
  'draft.ready': 10,
  kick: 10,
  ping: 10,
  'net.inputs': LIMITS_V2.inputsPerSec,
  'net.state': LIMITS_V2.statePerSec,
  'net.event': LIMITS.eventPerSec,
  'net.checksum': LIMITS_V2.checksumPerSec,
  'net.recovery.request': LIMITS_V2.recoveryPerSec,
  'net.recovery': LIMITS_V2.recoveryPerSec,
  'net.ready': LIMITS_V2.readyPerSec,
  'net.start.request': LIMITS_V2.startRequestPerSec,
  'net.end.request': LIMITS_V2.endRequestPerSec,
  'net.signal': LIMITS_V2.signalPerSec,
  'net.seat.request': LIMITS_V2.seatRequestPerSec,
  'net.pause.ack': 2,
  'net.pause.late': 2,
  'net.pause.position': 2,
  'match.pause.request': 2,
  'match.resume.request': 2,
} satisfies Record<RoomClientMessage['t'], number>;

function rejection(code: object, status: number): never {
  throw new ServerError(status, JSON.stringify(code));
}

function clientGrant(client: Client): RoomGrant {
  return client.auth as RoomGrant;
}

export class GameRoom extends Room<{ state: GameRoomState }> {
  readonly droppedCounts: Record<string, number> = Object.create(null) as Record<string, number>;

  private runtime!: RuntimeOptions;
  private timings!: RoomTimings;
  private readonly rates = new RateTable();
  private readonly violations = new Map<string, ViolationWindow>();
  private readonly revokedJtis = new Set<string>();
  private readonly revokedUsers = new Set<string>();
  private readonly invalidatedUsers = new Map<string, number>();
  private readonly forcedLeaves = new Map<string, ForcedLeave>();
  private readonly lastSeenRev = new Map<string, number>();
  private readonly readyUsers = new Set<string>();
  private previousPhase: GameRoomState['phase'] = 'editing';
  private idleTimer?: { clear(): void };
  private ending = false;
  private teamsPolicy: TeamPolicy = 'none';
  private spectatorsPolicy: 'off' | 'on' = 'off';
  private pauseOnDisconnect = true;
  private authorityMode = 'host';
  private startLeadMs: number = LIMITS_V2.startLeadMs;
  private readonly rejoinTimers = new Map<number, { clear(): void }>();
  private tickTimer?: { clear(): void };
  private matchResumeTimer?: { clear(): void };
  private matchProbeTimer?: { clear(): void };
  private readonly matchPauseAcks = new Set<string>();
  private readonly matchPausePositions = new Map<string, number>();
  private matchProbeAt = 0;
  private readonly matchLateUsers = new Set<string>();
  private matchPauseTick = 0;
  private matchResumeRequested = false;
  private matchUsesBarrier = false;
  /** Routing refusals by `DropCode`, beside `droppedCounts` (which counts by message type). */
  readonly seatDrops: Record<string, number> = Object.create(null) as Record<string, number>;

  async onAuth(_client: Client, rawOptions: unknown): Promise<RoomGrant> {
    const options = JoinOptionsSchema.safeParse(rawOptions);
    if (!options.success) rejection({ code: 'GRANT_INVALID' }, 401);

    const tokenResult = await verifyGrant(options.data.grant, this.runtime.grantSecret);
    if (!tokenResult.ok) rejection({ code: tokenResult.code }, 401);
    const grant = tokenResult.grant;
    if (
      grant.roomId !== this.roomId ||
      grant.gameId !== this.state.pin.gameId ||
      (grant.sub === this.state.ownerId) !== (grant.role === 'owner')
    ) {
      rejection({ code: 'GRANT_INVALID' }, 401);
    }
    if (options.data.protocol !== this.state.protocol) rejection({ code: 'PROTOCOL_MISMATCH' }, 409);
    if (this.isRevoked(grant)) rejection({ code: 'GRANT_REVOKED' }, 403);
    if (options.data.buildId !== this.state.pin.buildId && options.data.buildId !== this.state.draft?.buildId) {
      rejection(
        {
          code: 'BUILD_MISMATCH',
          expected: this.state.pin.toJSON(),
        },
        409,
      );
    }
    if (this.isV2) {
      this.evaluateV2Join(options.data, grant);
      return grant;
    }
    if (!this.state.members.has(grant.sub) && this.state.members.size >= this.state.maxPlayers) {
      rejection({ code: 'ROOM_FULL', max: this.state.maxPlayers }, 429);
    }
    return grant;
  }

  /**
   * Only evaluates: a rejected join must not consume a seat, because Colyseus may run `onAuth` for a join
   * that never completes (#497 §3.2). `onJoin` commits the assignment.
   */
  private evaluateV2Join(options: { seat?: number; rulesetHash?: string }, grant: RoomGrant): void {
    /* Equal, or either side absent, passes; only two different pins are a mismatch (#497 §3.9/S46). */
    const expected = this.state.rulesetHash;
    const claimed = options.rulesetHash ?? '';
    if (expected !== '' && claimed !== '' && claimed !== expected) {
      rejection({ code: 'RULESET_MISMATCH', expected }, 409);
    }
    const held = seatOfUser(this.state, grant.sub);
    if (held && this.matchLateUsers.has(grant.sub)) rejection({ code: 'SEAT_TAKEN', seat: held.seat }, 409);
    if (held?.forfeited === true) rejection({ code: 'SEAT_TAKEN', seat: held.seat }, 409);
    if (options.seat !== undefined && held?.seat !== options.seat) {
      rejection({ code: 'SEAT_TAKEN', seat: options.seat }, 409);
    }
    if (held !== undefined) return;
    if (lowestFreeSeat(this.state) !== undefined) return;
    if (this.state.spectators.includes(grant.sub)) return;
    if (this.spectatorsPolicy === 'on') return;
    rejection({ code: 'ROOM_FULL', max: this.state.maxPlayers }, 429);
  }

  onCreate(options: GameRoomOptions): void {
    if (options.runtime === undefined) throw new Error('rooms runtime options are required');
    this.runtime = options.runtime;
    this.timings = roomTimings({ ...options.runtime.timings, ...options.timings });
    const maxPlayers = Math.min(Math.max(Math.floor(options.maxPlayers), 1), LIMITS.maxPlayersCeiling);
    this.autoDispose = false;
    this.maxClients = 128;
    this.patchRate = 20;
    this.teamsPolicy = options.teams ?? 'none';
    this.spectatorsPolicy = options.spectators ?? 'off';
    this.pauseOnDisconnect = options.pauseOnDisconnect ?? true;
    this.authorityMode = options.mode ?? 'host';
    const lead = options.startLeadMs;
    this.startLeadMs = lead === undefined ? LIMITS_V2.startLeadMs : Math.min(Math.max(lead, 500), 5_000);
    this.setState(
      createRoomState({
        pin: { gameId: options.gameId, branchId: options.branchId, buildId: options.buildId },
        ownerId: options.ownerId,
        maxPlayers,
        protocol: options.protocol ?? PROTOCOL_VERSION_V1,
        teams: this.teamsPolicy,
        rulesetHash: options.rulesetHash ?? '',
      }),
    );
    liveRooms.set(this.roomId, this);
    this.armIdleTimer();
    this.registerHandlers();
  }

  onJoin(client: Client, _options: unknown, auth?: RoomGrant): void {
    const grant = auth ?? clientGrant(client);
    if (this.isRevoked(grant)) rejection({ code: 'GRANT_REVOKED' }, 403);
    client.auth = grant;
    this.cancelIdleTimer();
    if (this.isV2) return this.joinSeat(client, grant);

    let member = this.state.members.get(grant.sub);
    if (member === undefined) {
      member = new MembershipState();
      member.userId = grant.sub;
      member.name = grant.name;
      member.role = grant.role;
      member.playerIndex = grant.role === 'owner' ? 0 : this.lowestFreePlayerIndex();
      this.state.members.set(grant.sub, member);
    }
    if (!member.sessions.includes(client.sessionId)) member.sessions.push(client.sessionId);
    member.connected = true;
    this.lastSeenRev.set(grant.sub, this.lastSeenRev.get(grant.sub) ?? this.state.lastRev);

    if (grant.role === 'owner') this.state.editorSessionId = client.sessionId;
    this.clock.setTimeout(() => {
      client.send('welcome', {
        you: { userId: grant.sub, playerIndex: member.playerIndex, sessionId: client.sessionId },
        state: roomStateJson(this.state),
      });
    }, 0);
  }

  onDrop(client: Client): void {
    /* D-N3-3: a v2 seat is never reserved. Making a drop definitive here is what keeps a rejoin an
     * ordinary authenticated join, so one seat can never hold two live sessions. */
    if (this.isV2) {
      this.handleEditorDeparture(client);
      return;
    }
    if (this.forcedLeaves.has(client.sessionId)) return;
    const grant = clientGrant(client);
    const member = this.state.members.get(grant.sub);
    if (member !== undefined) member.connected = this.hasConnectedSession(grant.sub);

    this.handleEditorDeparture(client);
    if (this.clients.length === 0) this.armIdleTimer();
    this.allowReconnection(
      client,
      grant.role === 'owner' ? this.timings.ownerReconnectSec : this.timings.playerReconnectSec,
    );
  }

  onReconnect(client: Client): void {
    if (this.isV2) return;
    const grant = clientGrant(client);
    if (this.isRevoked(grant)) {
      this.forcedLeaves.set(client.sessionId, 'revoked');
      client.send('ended', { reason: 'revoked' });
      client.leave(4001);
      return;
    }
    const member = this.state.members.get(grant.sub);
    if (member !== undefined) member.connected = true;
    this.cancelIdleTimer();
    if (grant.role === 'owner') {
      this.state.editorSessionId = client.sessionId;
      if (this.state.phase === 'pausedForHost') this.setPhase(this.previousPhase);
    }
    client.send('resync', { fromRev: (this.lastSeenRev.get(grant.sub) ?? 0) + 1 });
  }

  async onLeave(client: Client, code?: number): Promise<void> {
    const seat = this.isV2 ? this.seatFor(client) : undefined;
    if (
      this.matchUsesBarrier &&
      this.state.pausedAt !== 0 &&
      seat !== undefined &&
      !this.matchPauseAcks.has(client.sessionId) &&
      !this.clients.some((peer) => peer.sessionId !== client.sessionId && clientGrant(peer).sub === seat.userId)
    ) {
      this.matchLateUsers.add(seat.userId);
    }
    this.matchPauseAcks.delete(client.sessionId);
    this.matchPausePositions.delete(client.sessionId);
    const grant = clientGrant(client);
    const forced = this.forcedLeaves.get(client.sessionId);
    this.forcedLeaves.delete(client.sessionId);
    this.violations.delete(client.sessionId);
    this.rates.prune(Date.now() - 60_000);
    this.handleEditorDeparture(client);
    if (this.isV2) return this.leaveSeat(grant, client, code, forced);
    this.removeSession(grant.sub, client.sessionId);
    if (this.clients.length === 0) this.armIdleTimer();
    if (this.ending) return;

    const hasRemainingOwnerSession = (this.state.members.get(grant.sub)?.sessions.length ?? 0) > 0;
    if (grant.role === 'owner' && !hasRemainingOwnerSession) {
      if (forced === 'revoked') await this.end('revoked');
      else if (code === CloseCode.CONSENTED) await this.end('owner-closed');
      else if (forced === undefined) await this.end('host-left');
    }
  }

  onDispose(): void {
    this.cancelIdleTimer();
    this.clearTickTimer();
    this.matchResumeTimer?.clear();
    this.matchProbeTimer?.clear();
    for (const timer of this.rejoinTimers.values()) timer.clear();
    this.rejoinTimers.clear();
    liveRooms.delete(this.roomId);
  }

  revoke(input: { jti?: string; userId?: string }): void {
    if (input.jti) this.revokedJtis.add(input.jti);
    if (input.userId) this.revokedUsers.add(input.userId);
    for (const client of [...this.clients]) {
      const grant = clientGrant(client);
      if ((input.jti && grant.jti === input.jti) || (input.userId && grant.sub === input.userId)) {
        this.forcedLeaves.set(client.sessionId, 'revoked');
        client.send('ended', { reason: 'revoked' });
        client.leave(4001);
      }
    }
  }

  invalidateUser(userId: string): void {
    this.invalidatedUsers.set(userId, Math.floor(Date.now() / 1000));
    for (const client of [...this.clients]) {
      if (clientGrant(client).sub === userId) {
        this.forcedLeaves.set(client.sessionId, 'revoked');
        client.send('ended', { reason: 'revoked' });
        client.leave(4001);
      }
    }
  }

  private registerHandlers(): void {
    this.onMessage('*', (client, type, payload) => {
      if (typeof type !== 'string') return this.drop(client, String(type));
      const parsed = RoomClientMessageSchema.safeParse({ t: type, ...normalizePayload(type, payload) });
      if (!parsed.success) return this.drop(client, type);
      if (!this.allowRate(client, parsed.data.t)) return;
      this.handleMessage(client, parsed.data);
    });
  }

  private handleMessage(client: Client, message: RoomClientMessage): void {
    if (message.t === 'match.pause.request') return this.pauseMatch(client);
    if (message.t === 'match.resume.request') return this.requestMatchResume(client);
    if (message.t.startsWith('net.')) return this.handleNetMessage(client, message as NetClientMessage);
    switch (message.t) {
      case 'input': {
        const result = validateInputFrame(message.f);
        const editor = this.editorClient();
        const member = this.state.members.get(clientGrant(client).sub);
        if (!result.ok || editor === undefined || member === undefined) return this.drop(client, message.t);
        editor.send('input', { f: { ...result.frame, playerIndex: member.playerIndex, from: member.userId } });
        return;
      }
      case 'snapshot':
      case 'event':
        if (!this.requireEditor(client, message.t)) return;
        this.broadcast(message.t, withoutType(message), { except: client });
        return;
      case 'design.tx': {
        if (!this.requireEditor(client, message.t)) return;
        const result = validateDesignTx(message.tx, this.state.pin);
        if (!result.ok) return this.drop(client, message.t);
        this.state.lastRev = Math.max(this.state.lastRev, result.tx.rev);
        this.broadcast(message.t, { tx: result.tx }, { except: client });
        for (const peer of this.clients) this.lastSeenRev.set(clientGrant(peer).sub, result.tx.rev);
        return;
      }
      case 'presence': {
        if (!this.requireEditor(client, message.t)) return;
        const current = this.state.presence.toJSON();
        const merged = ContractPresenceSchema.safeParse({ ...current, ...message.p });
        if (!merged.success) return this.drop(client, message.t);
        setPresence(this.state.presence, zeroPrivatePresence(merged.data));
        return;
      }
      case 'phase':
        if (!this.requireEditor(client, message.t)) return;
        this.setPhase(message.to);
        if (message.to === 'playing') this.state.playRev = this.state.lastRev;
        return;
      case 'draft.load':
        if (!this.requireEditor(client, message.t)) return;
        if (!this.isGamesUrl(message.url)) return this.drop(client, message.t);
        this.state.draft = Object.assign(new DraftState(), {
          buildId: message.buildId,
          url: message.url,
          expiresAt: Date.now() + 5 * 60_000,
        });
        this.readyUsers.clear();
        this.setPhase('migrating');
        return;
      case 'draft.ready': {
        const draft = this.state.draft;
        if (draft === undefined || draft.buildId !== message.buildId) return this.drop(client, message.t);
        this.readyUsers.add(clientGrant(client).sub);
        const connectedUsers = new Set(this.clients.map((peer) => clientGrant(peer).sub));
        if ([...connectedUsers].every((userId) => this.readyUsers.has(userId))) {
          this.state.pin.buildId = draft.buildId;
          this.state.draft = undefined;
          this.readyUsers.clear();
          this.setPhase('editing');
        }
        return;
      }
      case 'kick':
        if (!this.requireEditor(client, message.t)) return;
        for (const peer of [...this.clients]) {
          if (clientGrant(peer).sub === message.userId) {
            this.forcedLeaves.set(peer.sessionId, 'kick');
            peer.leave(4003);
          }
        }
        return;
      case 'ping':
        client.send('pong', { c: message.c, s: Date.now() });
        return;
    }
  }

  /* ---------------------------------------------------------------- protocol 2 */

  private get isV2(): boolean {
    return this.state.protocol === PROTOCOL_VERSION;
  }

  private seatFor(client: Client): SeatState | undefined {
    return seatOfUser(this.state, clientGrant(client).sub);
  }

  private handleNetMessage(client: Client, message: NetClientMessage): void {
    switch (message.t) {
      case 'net.ready': {
        const seat = this.seatFor(client);
        if (seat === undefined) return this.drop(client, message.t, 'SPECTATOR_NOT_SEATED');
        seat.ready = message.ready;
        this.broadcastSeats();
        return;
      }
      case 'net.start.request':
        return this.startEpoch(client, message.force === true);
      case 'net.end.request':
        return this.finishEpoch(client, message.epoch);
      case 'net.seat.request':
        return this.moveSeat(client, message.seat);
      case 'net.pause.ack':
        return this.acknowledgeMatchPause(client, message.epoch, message.tick);
      case 'net.pause.position':
        return this.recordMatchPosition(client, message.epoch, message.tick);
      case 'net.pause.late':
        if (
          this.state.matchPausedBy &&
          message.epoch === this.state.epoch &&
          message.tick === this.matchPauseTick &&
          this.seatFor(client)
        ) {
          this.matchLateUsers.add(clientGrant(client).sub);
          for (const peer of this.clients) {
            if (clientGrant(peer).sub === clientGrant(client).sub) peer.leave(4004);
          }
        }
        return;
      default:
        return this.relay(client, message);
    }
  }

  /** A v2 join: the room assigns the seat, binds a spectator when the seats are gone, then welcomes. */
  private joinSeat(client: Client, grant: RoomGrant): void {
    let seat = seatOfUser(this.state, grant.sub);
    if (seat === undefined) {
      const free = lowestFreeSeat(this.state);
      if (free === undefined) {
        if (!this.state.spectators.includes(grant.sub)) this.state.spectators.push(grant.sub);
      } else {
        bindUser(free, grant.sub, grant.name);
        seat = free;
      }
    } else {
      markOnline(seat);
      this.cancelRejoinTimer(seat.seat);
    }

    if (seat !== undefined) {
      this.attachSession(grant.sub, client.sessionId);
      syncMembersFromSeats(this.state);
      this.lastSeenRev.set(grant.sub, this.lastSeenRev.get(grant.sub) ?? this.state.lastRev);
    }
    if (grant.role === 'owner') this.state.editorSessionId = client.sessionId;
    if (seat !== undefined) this.broadcastSeatEvent('net.seat.online', seat.seat);
    this.broadcastSeats();

    const you = {
      userId: grant.sub,
      seat: seat?.seat ?? null,
      playerIndex: seat?.seat ?? -1,
      sessionId: client.sessionId,
      spectator: seat === undefined,
      team: seat?.team ?? 0,
    };
    this.clock.setTimeout(() => {
      client.send('welcome', {
        you,
        ...(this.state.epoch === '' ? {} : { epoch: this.state.epoch }),
        state: roomStateJson<RoomStateV2>(this.state),
      });
      if (this.state.epoch === '') return;
      const preparedPause = this.matchUsesBarrier && this.state.pausedAt !== 0;
      client.send('net.start', this.startPayload(seat?.seat, preparedPause));
      if (preparedPause && seat !== undefined && this.state.matchResumeAt === 0) this.armMatchAckTimeout();
      if (this.matchUsesBarrier && this.state.pausedAt === 0) {
        if (seat !== undefined) this.probeMatchPositions();
        else client.send('net.pause.probe', { epoch: this.state.epoch });
      } else if (this.state.pausedAt !== 0) {
        if (this.matchUsesBarrier)
          client.send('net.pause.prepare', { epoch: this.state.epoch, tick: this.matchPauseTick });
        else
          client.send('net.pause', {
            epoch: this.state.epoch,
            tick: tickAt(this.state, Date.now()),
            startAt: this.state.startAt,
          });
      }
      if (this.matchUsesBarrier && this.state.matchResumeAt > 0) {
        const at = this.state.matchResumeAt;
        client.send('net.resume', {
          epoch: this.state.epoch,
          tick: this.matchPauseTick,
          startAt: resumeAt(this.state, at).startAt,
          at,
        });
      }
      client.send('net.tick', {
        epoch: this.state.epoch,
        serverTime: Date.now(),
        tick: tickAt(this.state, Date.now()),
      });
    }, 0);

    if (seat !== undefined) {
      this.requestResumeIfPauserForfeited();
      this.resumeMatchWhenPrepared();
    }
    this.resumeIfReady();
  }

  /** A v2 departure: the seat survives its occupant; only the window or a deliberate exit ends it. */
  private leaveSeat(grant: RoomGrant, client: Client, code: number | undefined, forced: ForcedLeave | undefined): void {
    const lastSession = this.removeSession(grant.sub, client.sessionId, true);
    if (this.clients.length === 0) this.armIdleTimer();
    const seat = seatOfUser(this.state, grant.sub);
    if (seat === undefined) {
      this.dropSpectator(grant.sub);
      return;
    }
    if (!lastSession || this.ending) return;
    markOffline(seat);
    syncMembersFromSeats(this.state);
    /* D-N3-14: a deliberate exit forfeits at once — it never announces an offline window it will not hold. */
    if (code === CloseCode.CONSENTED || forced !== undefined) this.forfeitSeat(seat);
    else {
      this.broadcastSeatEvent('net.seat.offline', seat.seat);
      this.openRejoinWindow(seat);
    }
    this.broadcastSeats();
    const abandoned =
      [...this.state.seats].some((row) => row.userId !== '') &&
      [...this.state.seats].every((row) => row.userId === '' || row.forfeited);
    if (abandoned) void this.end('abandoned');
  }

  private dropSpectator(userId: string): void {
    const index = this.state.spectators.indexOf(userId);
    if (index < 0 || this.hasConnectedSession(userId)) return;
    this.state.spectators.splice(index, 1);
    this.broadcastSeats();
  }

  /** The 30-second window. Expiring forfeits the seat and, if it was the primary, re-elects one. */
  private openRejoinWindow(seat: SeatState): void {
    if (this.state.matchResumeAt !== 0) {
      this.matchResumeTimer?.clear();
      this.matchResumeTimer = undefined;
      this.state.matchResumeAt = 0;
      this.matchResumeRequested = false;
      if (this.matchUsesBarrier) {
        this.broadcast('net.pause', {
          epoch: this.state.epoch,
          tick: this.matchPauseTick,
          startAt: this.state.startAt,
        });
        this.armMatchAckTimeout();
      }
      this.broadcast('match.pause', { by: this.state.matchPausedBy, name: this.state.matchPauseName });
    }
    this.cancelRejoinTimer(seat.seat);
    const timer = this.clock.setTimeout(() => {
      this.rejoinTimers.delete(seat.seat);
      if (!seat.forfeited && !this.hasConnectedSession(seat.userId)) this.forfeitSeat(seat);
    }, this.timings.seatReconnectSec * 1_000);
    this.rejoinTimers.set(seat.seat, timer);

    if (this.state.epoch === '') return;
    if (Date.now() < this.state.startAt) return this.cancelStart('seat-offline');
    this.pauseForWindow();
  }

  private pauseForWindow(): void {
    if (this.matchUsesBarrier) return;
    if (!this.pauseOnDisconnect || this.state.pausedAt !== 0 || this.state.epoch === '') return;
    const now = Date.now();
    const clock = pauseAt({ startAt: this.state.startAt, pausedAt: this.state.pausedAt }, now);
    this.state.pausedAt = clock.pausedAt;
    this.broadcast('net.pause', { epoch: this.state.epoch, tick: tickAt(clock, now), startAt: this.state.startAt });
  }

  private pauseMatch(client: Client): void {
    if (!this.isV2 || this.state.phase !== 'playing' || this.state.matchPausedBy !== '' || this.state.pausedAt !== 0)
      return;
    const seat = this.seatFor(client);
    if (seat === undefined || seat.forfeited) return;
    if (this.state.epoch !== '' && Date.now() < this.state.startAt) {
      this.clock.setTimeout(() => {
        if (this.clients.includes(client)) this.pauseMatch(client);
      }, this.state.startAt - Date.now());
      return;
    }
    this.state.matchPausedBy = seat.userId;
    this.state.matchPauseName = seat.name;
    this.matchPauseAcks.clear();
    this.matchPausePositions.clear();
    this.matchResumeRequested = false;
    this.matchUsesBarrier = this.state.epoch !== '' && this.authorityMode === 'per-seat';
    if (this.state.epoch !== '' && this.state.pausedAt === 0) {
      const now = Date.now();
      if (this.matchUsesBarrier) {
        this.probeMatchPositions();
      } else {
        this.state.pausedAt = now;
        this.broadcast('net.pause', {
          epoch: this.state.epoch,
          tick: tickAt(this.state, now),
          startAt: this.state.startAt,
        });
      }
    }
    this.broadcast('match.pause', { by: seat.userId, name: seat.name });
  }

  /** Asks every seat for its tick again, so the boundary lead covers only the time since this probe. */
  private probeMatchPositions(): void {
    this.matchPausePositions.clear();
    this.matchProbeAt = Date.now();
    this.broadcast('net.pause.probe', { epoch: this.state.epoch });
    this.matchProbeTimer?.clear();
    this.matchProbeTimer = this.clock.setTimeout(() => {
      this.matchProbeTimer = undefined;
      this.fallBackFromSilentProbe();
    }, MATCH_PROBE_TIMEOUT_MS);
  }

  /**
   * An SDK answers a probe as the message arrives, so a connected seat that stays silent runs an SDK built before
   * the barrier (Blobs ships one). The match then pauses the way those builds understand: at the room's tick, now.
   */
  private fallBackFromSilentProbe(): void {
    if (!this.matchUsesBarrier || !this.state.matchPausedBy || this.state.pausedAt !== 0) return;
    const silent = this.clients.some((peer) => {
      const peerSeat = this.seatFor(peer);
      return peerSeat !== undefined && !peerSeat.forfeited && !this.matchPausePositions.has(peer.sessionId);
    });
    if (!silent) return;
    this.matchUsesBarrier = false;
    this.matchPausePositions.clear();
    const now = Date.now();
    this.state.pausedAt = now;
    this.broadcast('net.pause', {
      epoch: this.state.epoch,
      tick: tickAt(this.state, now),
      startAt: this.state.startAt,
    });
    this.resumeMatchWhenPrepared();
  }

  /** A seat that has not reached the prepared boundary in time is treated as late: it leaves and its window runs. */
  private armMatchAckTimeout(): void {
    this.matchProbeTimer?.clear();
    this.matchProbeTimer = this.clock.setTimeout(() => {
      this.matchProbeTimer = undefined;
      if (!this.matchUsesBarrier || !this.state.matchPausedBy || this.state.pausedAt === 0) return;
      for (const peer of this.clients) {
        const peerSeat = this.seatFor(peer);
        if (peerSeat === undefined || peerSeat.forfeited || this.matchPauseAcks.has(peer.sessionId)) continue;
        this.matchLateUsers.add(peerSeat.userId);
        peer.leave(4004);
      }
      this.armMatchAckTimeout();
    }, this.timings.seatReconnectSec * 1_000);
  }

  private recordMatchPosition(client: Client, epoch: string, tick: number): void {
    if (!this.matchUsesBarrier || !this.state.matchPausedBy || this.state.pausedAt !== 0 || epoch !== this.state.epoch)
      return;
    const seat = this.seatFor(client);
    if (!seat || seat.forfeited) return;
    const maxRoomTick = tickAt(this.state, Date.now()) + SIM_TICK_HZ;
    this.matchPausePositions.set(client.sessionId, Math.min(tick, maxRoomTick));
    this.prepareMatchWhenPositionsReady();
  }

  private prepareMatchWhenPositionsReady(): void {
    if (!this.matchUsesBarrier || !this.state.matchPausedBy || this.state.pausedAt !== 0) return;
    const players = this.clients.filter((peer) => {
      const peerSeat = this.seatFor(peer);
      return peerSeat !== undefined && !peerSeat.forfeited;
    });
    if (players.length === 0) return;
    if (players.some((peer) => !this.matchPausePositions.has(peer.sessionId))) return;
    if ([...this.state.seats].some((row) => row.userId !== '' && !row.connected && !row.forfeited)) return;
    const leadTicks = Math.max(12, Math.ceil(((Date.now() - this.matchProbeAt) * SIM_TICK_HZ) / 1000) + 6);
    this.matchPauseTick = Math.max(...players.map((peer) => this.matchPausePositions.get(peer.sessionId)!)) + leadTicks;
    this.state.pausedAt = this.state.startAt + Math.ceil((this.matchPauseTick * 1000) / SIM_TICK_HZ);
    this.armMatchAckTimeout();
    this.broadcast('net.pause.prepare', { epoch: this.state.epoch, tick: this.matchPauseTick });
  }

  private requestMatchResume(client: Client): void {
    const seat = this.seatFor(client);
    if (
      !this.isV2 ||
      seat === undefined ||
      seat.forfeited ||
      this.state.matchPausedBy === '' ||
      this.state.matchResumeAt !== 0
    )
      return;
    const occupied = [...this.state.seats].filter((row) => row.userId !== '' && !row.forfeited);
    if (occupied.some((row) => !row.connected)) return;
    const pauserSeated = occupied.some((row) => row.userId === this.state.matchPausedBy);
    if (seat.userId !== this.state.matchPausedBy && occupied.length !== 2 && pauserSeated) return;
    this.matchResumeRequested = true;
    this.prepareMatchWhenPositionsReady();
    this.resumeMatchWhenPrepared();
  }

  private acknowledgeMatchPause(client: Client, epoch: string, tick: number): void {
    const seat = this.seatFor(client);
    if (
      !this.state.matchPausedBy ||
      epoch !== this.state.epoch ||
      tick !== this.matchPauseTick ||
      !seat ||
      seat.forfeited
    )
      return;
    this.matchPauseAcks.add(client.sessionId);
    this.resumeMatchWhenPrepared();
  }

  private resumeMatchWhenPrepared(): void {
    if (!this.matchResumeRequested || this.state.matchResumeAt !== 0 || !this.state.matchPausedBy) return;
    if (this.matchUsesBarrier && this.state.pausedAt === 0) return;
    if ([...this.state.seats].some((seat) => seat.userId !== '' && !seat.connected && !seat.forfeited)) return;
    if (
      this.matchUsesBarrier &&
      this.clients.some((client) => {
        const seat = this.seatFor(client);
        return seat !== undefined && !seat.forfeited && !this.matchPauseAcks.has(client.sessionId);
      })
    )
      return;
    this.scheduleMatchResume();
  }

  private scheduleMatchResume(): void {
    this.matchProbeTimer?.clear();
    this.matchProbeTimer = undefined;
    const at = Date.now() + 3_000;
    this.state.matchResumeAt = at;
    this.broadcast('match.resume', { at });
    const barrierClock = this.matchUsesBarrier ? resumeAt(this.state, at) : undefined;
    if (barrierClock) {
      this.broadcast('net.resume', {
        epoch: this.state.epoch,
        tick: this.matchPauseTick,
        startAt: barrierClock.startAt,
        at,
      });
    }
    this.matchResumeTimer = this.clock.setTimeout(() => {
      this.matchResumeTimer = undefined;
      this.state.matchPausedBy = '';
      this.state.matchPauseName = '';
      this.state.matchResumeAt = 0;
      this.matchResumeRequested = false;
      this.matchPauseAcks.clear();
      this.matchLateUsers.clear();
      this.matchUsesBarrier = false;
      if (barrierClock) {
        this.state.startAt = barrierClock.startAt;
        this.state.pausedAt = 0;
      } else this.resumeIfReady();
      this.broadcast('match.resumed', {});
    }, 3_000);
  }

  private resumeIfReady(): void {
    if (this.state.matchPausedBy !== '') return;
    if (this.state.epoch === '' || this.state.pausedAt === 0) return;
    if ([...this.state.seats].some((seat) => seat.userId !== '' && !seat.connected && !seat.forfeited)) return;
    const now = Date.now();
    const clock = resumeAt({ startAt: this.state.startAt, pausedAt: this.state.pausedAt }, now);
    this.state.startAt = clock.startAt;
    this.state.pausedAt = 0;
    this.broadcast('net.resume', { epoch: this.state.epoch, tick: tickAt(clock, now), startAt: clock.startAt });
  }

  private forfeitSeat(seat: SeatState): void {
    this.cancelRejoinTimer(seat.seat);
    const wasPrimary = seat.seat === this.state.primarySeat;
    forfeit(seat);
    this.broadcastSeatEvent('net.seat.forfeit', seat.seat);
    if (wasPrimary && this.state.epoch !== '') {
      const next = electPrimary(this.state);
      if (next !== undefined) {
        this.state.primarySeat = next;
        this.broadcast('net.primary', { epoch: this.state.epoch, seat: next });
      }
    }
    this.broadcastSeats();
    this.requestResumeIfPauserForfeited();
    this.prepareMatchWhenPositionsReady();
    this.resumeMatchWhenPrepared();
    this.resumeIfReady();
  }

  private startEpoch(client: Client, force: boolean): void {
    const seat = this.seatFor(client);
    if (seat === undefined) return this.drop(client, 'net.start.request', 'SPECTATOR_NOT_SEATED');
    /* The primary is derived, not stored history: elect before validating so a room whose seat 0 never
     * joined (or forfeited) can still start, and a stale primary cannot hold the match. */
    const elected = electPrimary(this.state);
    if (elected !== undefined) this.state.primarySeat = elected;
    if (seat.seat !== this.state.primarySeat) return this.drop(client, 'net.start.request', 'NOT_PRIMARY');
    if (this.state.epoch !== '') return this.drop(client, 'net.start.request', 'EPOCH_ACTIVE');
    if (!force && !canStart(seatsSnapshot(this.state))) return this.drop(client, 'net.start.request', 'NOT_READY');

    const minted = mintEpoch({ now: Date.now(), primarySeat: this.state.primarySeat, leadMs: this.startLeadMs });
    this.state.epoch = minted.epoch;
    this.state.startAt = minted.startAt;
    this.state.pausedAt = 0;
    this.state.seed = minted.seed;
    this.state.primarySeat = minted.primarySeat;
    this.setPhase('playing');
    this.state.playRev = this.state.lastRev;
    this.broadcast('net.primary', { epoch: minted.epoch, seat: minted.primarySeat });
    for (const peer of this.clients) peer.send('net.start', this.startPayload(this.seatFor(peer)?.seat));
    this.startTickTimer();
  }

  /** Once the pauser has forfeited, nobody may be left holding the pause: the countdown starts when every seat is back. */
  private requestResumeIfPauserForfeited(): void {
    if (this.state.matchPausedBy === '' || this.state.matchResumeAt !== 0) return;
    const seats = [...this.state.seats];
    if (seats.some((row) => row.userId === this.state.matchPausedBy && !row.forfeited)) return;
    if (seats.some((row) => row.userId !== '' && !row.connected && !row.forfeited)) return;
    this.matchResumeRequested = true;
  }

  /**
   * `beforePause` places a seat joining a prepared pause short of the boundary, so it runs up to that tick and
   * acknowledges it like the others instead of starting past it and being sent away as late. During the resume
   * countdown it gets the resumed clock, which reaches the boundary exactly when every other seat resumes.
   */
  private startPayload(seat: number | undefined, beforePause = false): object {
    let startAt = this.state.startAt;
    if (beforePause && this.state.matchResumeAt > 0) startAt = resumeAt(this.state, this.state.matchResumeAt).startAt;
    else if (beforePause) {
      startAt = resumeAt(this.state, Math.max(Date.now(), this.state.pausedAt)).startAt + PREPARED_JOIN_MARGIN_MS;
    }
    return {
      epoch: this.state.epoch,
      mode: this.authorityMode,
      startAt,
      seed: this.state.seed,
      primarySeat: this.state.primarySeat,
      seats: seatsSnapshot(this.state),
      ...(seat === undefined ? {} : { privateSeed: privateSeedFor(this.state.seed, seat) }),
    };
  }

  private cancelStart(reason: 'seat-offline' | 'not-ready'): void {
    if (this.state.epoch === '') return;
    this.clearMatchPause();
    this.state.epoch = '';
    this.state.startAt = 0;
    this.state.pausedAt = 0;
    this.state.seed = 0;
    this.clearTickTimer();
    this.setPhase('editing');
    this.broadcast('net.start.cancel', { reason });
  }

  /**
   * `net.end.request` / `net.epoch.end` (D-N3-11): the smallest way to serve best-of-three. Every seat
   * number is kept and every forfeited seat is released, so a round that lost a player can still seat four.
   */
  private finishEpoch(client: Client, epoch: string): void {
    const seat = this.seatFor(client);
    if (seat === undefined) return this.drop(client, 'net.end.request', 'SPECTATOR_NOT_SEATED');
    if (seat.seat !== this.state.primarySeat) return this.drop(client, 'net.end.request', 'NOT_PRIMARY');
    if (this.state.epoch === '' || this.state.epoch !== epoch) {
      return this.drop(client, 'net.end.request', 'NO_EPOCH');
    }
    const tick = tickAt(this.state, Date.now());
    this.clearMatchPause();
    this.broadcast('net.epoch.end', { epoch, tick });
    this.state.epoch = '';
    this.state.startAt = 0;
    this.state.pausedAt = 0;
    this.state.seed = 0;
    this.clearTickTimer();
    for (const timer of this.rejoinTimers.values()) timer.clear();
    this.rejoinTimers.clear();
    releaseForfeited(this.state, this.teamsPolicy);
    syncMembersFromSeats(this.state);
    this.setPhase('editing');
    this.broadcastSeats();
  }

  private moveSeat(client: Client, target: number): void {
    const seat = this.seatFor(client);
    if (seat === undefined) return this.drop(client, 'net.seat.request', 'SPECTATOR_NOT_SEATED');
    if (this.state.epoch !== '') return this.drop(client, 'net.seat.request', 'EPOCH_ACTIVE');
    const destination = [...this.state.seats].find((row) => row.seat === target);
    if (destination === undefined || !isFree(destination)) {
      return this.drop(client, 'net.seat.request', 'INVALID_SEAT_REQUEST');
    }
    const userId = seat.userId;
    const name = seat.name;
    this.cancelRejoinTimer(seat.seat);
    freeSeat(seat, teamOf(seat.seat, this.teamsPolicy));
    bindUser(destination, userId, name);
    syncMembersFromSeats(this.state);
    this.broadcastSeats();
  }

  /** Validates the envelope, re-stamps the sender's seat from the grant and routes. Never parses `data`. */
  private relay(client: Client, message: NetClientMessage): void {
    const epoch = 'epoch' in message ? message.epoch : undefined;
    const lobbyEvent = message.t === 'net.event' && epoch === 'lobby' && this.state.epoch === '';
    if (!lobbyEvent && (this.state.epoch === '' || epoch !== this.state.epoch))
      return this.drop(client, message.t, 'NO_EPOCH');
    const seat = this.seatFor(client);
    if (seat === undefined) return this.drop(client, message.t, 'SPECTATOR_NOT_SEATED');

    const stamped = restamp(message, seat.seat);
    const result = recipientsFor({
      message: stamped,
      senderSessionId: client.sessionId,
      senderSeat: seat.seat,
      seats: this.seatRecords(),
      spectators: this.spectatorRecords(),
      primarySeat: this.state.primarySeat,
    });
    if (result.drop !== undefined) return this.drop(client, message.t, result.drop);
    for (const peer of this.clients) {
      if (result.sessions.includes(peer.sessionId)) peer.send(stamped.t, payloadOf(stamped));
    }
  }

  private seatRecords(): SeatRecord[] {
    return [...this.state.seats].map((seat) => ({
      seat: seat.seat,
      userId: seat.userId,
      team: seat.team,
      connected: seat.connected,
      forfeited: seat.forfeited,
      sessions: seat.userId === '' ? [] : this.sessionsOf(seat.userId),
    }));
  }

  private spectatorRecords(): { userId: string; sessions: string[] }[] {
    return [...this.state.spectators].map((userId) => ({ userId, sessions: this.sessionsOf(userId) }));
  }

  private sessionsOf(userId: string): string[] {
    return this.clients.filter((client) => clientGrant(client).sub === userId).map((client) => client.sessionId);
  }

  private attachSession(userId: string, sessionId: string): void {
    let member = this.state.members.get(userId);
    if (member === undefined) {
      member = new MembershipState();
      member.userId = userId;
      this.state.members.set(userId, member);
    }
    if (!member.sessions.includes(sessionId)) member.sessions.push(sessionId);
    member.connected = true;
  }

  private broadcastSeats(): void {
    this.broadcast('net.seats', {
      epoch: this.state.epoch,
      seats: seatsSnapshot(this.state),
      spectators: [...this.state.spectators],
    });
  }

  private broadcastSeatEvent(event: 'net.seat.online' | 'net.seat.offline' | 'net.seat.forfeit', seat: number): void {
    this.broadcast('net.seat', { event, epoch: this.state.epoch, seat });
  }

  private startTickTimer(): void {
    this.clearTickTimer();
    this.tickTimer = this.clock.setInterval(() => {
      if (this.state.epoch === '') return;
      const serverTime = Date.now();
      this.broadcast('net.tick', { epoch: this.state.epoch, serverTime, tick: tickAt(this.state, serverTime) });
    }, 1_000);
  }

  private clearTickTimer(): void {
    this.tickTimer?.clear();
    this.tickTimer = undefined;
  }

  private cancelRejoinTimer(seat: number): void {
    this.rejoinTimers.get(seat)?.clear();
    this.rejoinTimers.delete(seat);
  }

  private requireEditor(client: Client, type: string): boolean {
    if (client.sessionId === this.state.editorSessionId) return true;
    this.drop(client, type);
    return false;
  }

  private allowRate(client: Client, type: RoomClientMessage['t']): boolean {
    const limit = RATE_LIMITS[type];
    if (this.rates.allow(`${client.sessionId}:${type}`, limit)) return true;
    this.drop(client, type);
    return false;
  }

  private drop(client: Client, type: string, code?: DropCode): void {
    if (code !== undefined) this.seatDrops[code] = (this.seatDrops[code] ?? 0) + 1;
    const metric = Object.hasOwn(RATE_LIMITS, type) ? type : 'invalid';
    this.droppedCounts[metric] = (this.droppedCounts[metric] ?? 0) + 1;
    recordDropped(metric);
    const now = Date.now();
    const previous = this.violations.get(client.sessionId);
    const window =
      previous === undefined || now - previous.startedAt >= 60_000
        ? { count: 1, startedAt: now }
        : { count: previous.count + 1, startedAt: previous.startedAt };
    this.violations.set(client.sessionId, window);
    if (window.count >= 1_000) {
      this.forcedLeaves.set(client.sessionId, 'rate');
      client.leave(4002);
    }
  }

  private lowestFreePlayerIndex(): number {
    const used = new Set([...this.state.members.values()].map((member) => member.playerIndex));
    for (let index = 1; index < this.state.maxPlayers; index += 1) if (!used.has(index)) return index;
    rejection({ code: 'ROOM_FULL', max: this.state.maxPlayers }, 429);
  }

  private editorClient(): Client | undefined {
    return this.clients.find((client) => client.sessionId === this.state.editorSessionId);
  }

  private connectedOwnerSessions(): Client[] {
    return this.clients.filter((client) => clientGrant(client).sub === this.state.ownerId);
  }

  private handleEditorDeparture(client: Client): void {
    if (client.sessionId !== this.state.editorSessionId) return;
    const replacement = this.connectedOwnerSessions().at(-1);
    if (replacement) {
      this.state.editorSessionId = replacement.sessionId;
      return;
    }
    this.previousPhase = this.state.phase === 'pausedForHost' ? this.previousPhase : this.state.phase;
    this.state.editorSessionId = undefined;
    /* D-N3-13: `pausedForHost` stays an editing-phase rule; a v2 match pauses through its own mechanism. */
    if (this.isV2 && this.state.phase === 'playing') return;
    this.setPhase('pausedForHost');
  }

  private isRevoked(grant: RoomGrant): boolean {
    return (
      this.revokedJtis.has(grant.jti) ||
      this.revokedUsers.has(grant.sub) ||
      grant.iat <= (this.invalidatedUsers.get(grant.sub) ?? -1)
    );
  }

  private hasConnectedSession(userId: string): boolean {
    return this.clients.some((client) => clientGrant(client).sub === userId);
  }

  private removeSession(userId: string, sessionId: string, keepMember = false): boolean {
    const member = this.state.members.get(userId);
    if (member === undefined) return false;
    const index = member.sessions.indexOf(sessionId);
    if (index >= 0) member.sessions.splice(index, 1);
    member.connected = this.hasConnectedSession(userId);
    if (member.sessions.length === 0 && !keepMember) {
      this.state.members.delete(userId);
      this.lastSeenRev.delete(userId);
      this.readyUsers.delete(userId);
    }
    return member.sessions.length === 0;
  }

  private setPhase(phase: GameRoomState['phase']): void {
    if (phase !== 'playing') this.clearMatchPause();
    this.state.phase = phase;
    this.state.phaseAt = Date.now();
  }

  private clearMatchPause(): void {
    this.matchProbeTimer?.clear();
    this.matchProbeTimer = undefined;
    this.matchResumeTimer?.clear();
    this.matchResumeTimer = undefined;
    if (
      this.state.matchPausedBy !== '' &&
      this.state.epoch !== '' &&
      this.state.pausedAt === 0 &&
      this.matchUsesBarrier
    ) {
      this.broadcast('net.resume', {
        epoch: this.state.epoch,
        tick: tickAt(this.state, Date.now()),
        startAt: this.state.startAt,
      });
    } else if (this.state.matchPausedBy !== '' && this.state.epoch !== '' && this.state.pausedAt !== 0) {
      const now = Date.now();
      const clock = resumeAt(this.state, Math.max(now, this.state.pausedAt));
      this.state.startAt = clock.startAt;
      this.state.pausedAt = 0;
      this.broadcast('net.resume', { epoch: this.state.epoch, tick: tickAt(clock, now), startAt: clock.startAt });
    }
    if (this.state.matchPausedBy !== '') this.broadcast('match.resumed', {});
    this.state.matchPausedBy = '';
    this.state.matchPauseName = '';
    this.state.matchResumeAt = 0;
    this.matchResumeRequested = false;
    this.matchPauseAcks.clear();
    this.matchPausePositions.clear();
    this.matchLateUsers.clear();
    this.matchUsesBarrier = false;
  }

  private isGamesUrl(value: string): boolean {
    try {
      const url = new URL(value);
      const origin = new URL(this.runtime.gamesOrigin);
      return url.origin === origin.origin && value.startsWith(this.runtime.gamesOrigin.replace(/\/$/, ''));
    } catch {
      return false;
    }
  }

  private armIdleTimer(): void {
    this.cancelIdleTimer();
    this.idleTimer = this.clock.setTimeout(() => void this.end('idle'), this.timings.idleDisposeSec * 1_000);
  }

  private cancelIdleTimer(): void {
    this.idleTimer?.clear();
    this.idleTimer = undefined;
  }

  private async end(reason: EndReason): Promise<void> {
    if (this.ending) return;
    this.ending = true;
    this.cancelIdleTimer();
    this.setPhase('ended');
    this.broadcast('ended', { reason });
    const callback = await postEnded({
      apiInternalUrl: this.runtime.apiInternalUrl,
      fetchFn: this.runtime.fetchFn,
      internalSecret: this.runtime.internalSecret,
      reason,
      retryMs: this.timings.callbackRetryMs,
      roomId: this.roomId,
      timeoutMs: this.timings.callbackTimeoutMs,
    });
    if (!callback.ok) {
      console.error(JSON.stringify({ event: 'ended-callback-failed', service: 'rooms', roomId: this.roomId, reason }));
    }
    this.clock.setTimeout(() => void this.disconnect(), 0);
  }
}

/** The sender's seat and event source are the room's, never the payload's (#497 §4.4). */
function restamp(message: NetClientMessage, seat: number): NetClientMessage {
  switch (message.t) {
    case 'net.inputs':
    case 'net.state':
      return { ...message, seat };
    case 'net.event':
      return { ...message, from: seat };
    default:
      return message;
  }
}

function payloadOf(message: { t: string }): object {
  return Object.fromEntries(Object.entries(message).filter(([key]) => key !== 't'));
}

function normalizePayload(type: string, payload: unknown): object {
  if (type !== 'input' || payload === null || typeof payload !== 'object') return payload as object;
  const frame = (payload as { f?: unknown }).f;
  if (frame === null || typeof frame !== 'object') return payload as object;
  const source = frame as Record<string, unknown>;
  return {
    f: {
      seq: source.seq,
      tick: source.tick,
      axes: source.axes,
      buttons: source.buttons,
    },
  };
}

function withoutType(message: Extract<RoomClientMessage, { t: 'snapshot' | 'event' }>): object {
  return message.t === 'snapshot'
    ? { seq: message.seq, tick: message.tick, data: message.data }
    : { seq: message.seq, data: message.data };
}

export function roomCount(): number {
  return liveRooms.size;
}
