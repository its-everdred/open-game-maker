import { Client as ColyseusClient } from '@colyseus/sdk';
import {
  RoomClientMessageSchema,
  RoomServerMessageSchema,
  RoomStateV2Schema,
  JoinRejectionSchema,
  LIMITS,
  PROTOCOL_VERSION,
  type RoomClientMessage,
  type NetServerMessage,
  type JoinOptions,
  type Phase,
  type RoomPin,
  type ServerMessage,
} from '@ogm/contracts/browser';

import { api } from '../lib/api/client';
import { useRoom, type RoomStoreApi } from './room-store';
import { roomStateV1From, serverMessageV1 } from './room-state-v1';

type Signal<Listener extends (...args: never[]) => unknown> = {
  (listener: Listener): unknown;
  remove(listener: Listener): void;
};

export type RoomTransport = {
  sessionId: string;
  reconnectionToken: string;
  reconnection?: { enabled: boolean };
  onStateChange: Signal<(state: unknown) => void>;
  onLeave: Signal<(code: number, reason?: string) => void>;
  onMessage(type: '*', listener: (type: string | number, payload: unknown) => void): () => void;
  send(type: string, payload?: unknown): void;
  leave(consented?: boolean): Promise<unknown>;
};

export type ClientTransport = {
  joinById(roomId: string, options: JoinOptions): Promise<RoomTransport>;
  reconnect(reconnectionToken: string): Promise<RoomTransport>;
};

export type RoomGrant = {
  grant: string;
  pin: RoomPin;
  expiresAt: number;
};

export type JoinRoom = RoomGrant & { roomId: string };
export type ServerMessageListener = (message: ServerMessage) => void;

export type RoomClientOptions = {
  roomsUrl: string;
  store?: RoomStoreApi;
  fetchGrant?: (roomId: string) => Promise<RoomGrant>;
  clientFactory?: (roomsUrl: string) => ClientTransport;
  now?: () => number;
  /** Ping cadence by phase; the relay transport reads these pongs. 1 Hz while playing, 5 s otherwise by default. */
  pingIntervalMs?: (phase?: Phase) => number;
};

const encoder = new TextEncoder();
const reconnectDelays = [0, 500, 1_000, 2_000, 4_000];
const receivedLimit = 2_000;

export class RoomClient {
  readonly store: RoomStoreApi;

  private readonly transport: ClientTransport;
  private readonly fetchGrant: (roomId: string) => Promise<RoomGrant>;
  private readonly now: () => number;
  private readonly pingInterval: (phase?: Phase) => number;
  private readonly listeners = new Set<ServerMessageListener>();
  private readonly netListeners = new Set<(message: NetServerMessage) => void>();
  private readonly receivedMessages: ServerMessage[] = [];
  private readonly warned = new Set<RoomClientMessage['t']>();
  private room?: RoomTransport;
  private credentials?: JoinRoom;
  private roomCleanup: Array<() => void> = [];
  private grantTimer?: ReturnType<typeof setTimeout>;
  private pingTimer?: ReturnType<typeof setTimeout>;
  private matchResumeTimer?: ReturnType<typeof setTimeout>;
  private bestPingRtt?: number;
  private pingPhaseUnsubscribe?: () => void;
  private refreshInFlight?: { operationId: number; promise: Promise<boolean> };
  private consentedLeave = false;
  private reconnectingOperationId?: number;
  private welcomed = false;
  private seatsFingerprint = '';
  private operationId = 0;

  constructor(options: RoomClientOptions) {
    this.store = options.store ?? useRoom;
    this.transport =
      options.clientFactory?.(options.roomsUrl) ?? (new ColyseusClient(options.roomsUrl) as unknown as ClientTransport);
    this.fetchGrant = options.fetchGrant ?? fetchRoomGrant;
    this.now = options.now ?? Date.now;
    this.pingInterval = options.pingIntervalMs ?? defaultPingInterval;
    this.store.getState().bind(this);
  }

  async join(input: JoinRoom): Promise<void> {
    const operationId = ++this.operationId;
    this.bestPingRtt = undefined;
    const previousRoom = this.room;
    this.consentedLeave = true;
    this.clearTimers();
    this.detachRoom();
    this.consentedLeave = false;
    this.credentials = input;
    this.store.getState().connection('connecting');
    if (previousRoom !== undefined) await discardRoom(previousRoom);
    if (!this.isCurrent(operationId)) return;
    this.scheduleGrantRefresh(input.expiresAt, operationId);
    await this.joinCurrent(false, operationId);
  }

  send(message: RoomClientMessage): void {
    if (this.room === undefined) return;
    const parsed = RoomClientMessageSchema.safeParse(message);
    if (!parsed.success || exceedsClientLimit(message)) {
      this.warnOnce(message.t);
      return;
    }
    const { t, ...payload } = parsed.data;
    this.room.send(t, payload);
  }

  subscribe(listener: ServerMessageListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeNet(listener: (message: NetServerMessage) => void): () => void {
    this.netListeners.add(listener);
    return () => this.netListeners.delete(listener);
  }

  received(): ServerMessage[] {
    return [...this.receivedMessages];
  }

  async leave(consented = true): Promise<void> {
    if (!consented) {
      this.consentedLeave = false;
      if (this.room !== undefined) await this.room.leave(false);
      return;
    }
    const operationId = ++this.operationId;
    const room = this.room;
    this.consentedLeave = true;
    this.credentials = undefined;
    this.refreshInFlight = undefined;
    this.clearTimers();
    try {
      if (room !== undefined) await room.leave(true);
    } finally {
      if (this.isCurrent(operationId)) {
        if (this.room === room) this.detachRoom();
        if (this.store.getState().status !== 'ended') this.store.getState().connection('idle');
      }
    }
  }

  private async joinCurrent(refreshed: boolean, operationId: number): Promise<void> {
    if (!this.isCurrent(operationId)) return;
    const credentials = this.credentials;
    if (credentials === undefined) return;
    try {
      const room = await this.transport.joinById(credentials.roomId, {
        grant: credentials.grant,
        buildId: credentials.pin.buildId,
        protocol: PROTOCOL_VERSION,
      });
      if (!this.isCurrent(operationId)) {
        await discardRoom(room);
        return;
      }
      this.attachRoom(room, false, operationId);
    } catch (error) {
      if (!this.isCurrent(operationId)) return;
      const rejection = parseJoinRejection(error);
      if (rejection.code === 'GRANT_EXPIRED' && !refreshed && (await this.refreshGrant(operationId))) {
        await this.joinCurrent(true, operationId);
        return;
      }
      this.clearTimers();
      this.store.getState().reject(rejection);
    }
  }

  private attachRoom(room: RoomTransport, connected: boolean, operationId: number): void {
    if (!this.isCurrent(operationId)) return;
    this.detachRoom();
    this.room = room;
    this.welcomed = connected && this.store.getState().you !== undefined;
    if (room.reconnection !== undefined) room.reconnection.enabled = false;

    const onState = (raw: unknown) => {
      if (!this.isAttached(room, operationId)) return;
      const state = roomStateV1From(toJson(raw));
      if (state === undefined) return;
      if (!this.welcomed) {
        const member = Object.values(state.members).find(({ sessions }) => sessions.includes(room.sessionId));
        if (member !== undefined) {
          this.acceptMessage(
            {
              t: 'welcome',
              you: { userId: member.userId, playerIndex: member.playerIndex, sessionId: room.sessionId },
              state,
            },
            false,
          );
          this.syncMatchState(toJson(raw));
          return;
        }
      }
      this.store.getState().sync(state);
      this.syncMatchState(toJson(raw));
    };
    const onLeave = () => {
      if (!this.isAttached(room, operationId) || this.consentedLeave || this.store.getState().status === 'ended')
        return;
      this.cancelMatchResume();
      const pause = this.store.getState().matchPause;
      if (pause) this.store.setState({ matchPause: { ...pause, resumeAt: 0 } });
      void this.reconnect(room.reconnectionToken, operationId);
    };
    room.onStateChange(onState);
    room.onLeave(onLeave);
    const removeMessages = room.onMessage('*', (type, payload) => {
      if (this.isAttached(room, operationId)) this.receive(String(type), payload);
    });
    this.roomCleanup = [removeMessages, () => room.onStateChange.remove(onState), () => room.onLeave.remove(onLeave)];
    if (connected) this.store.getState().connection('connected');
  }

  private detachRoom(): void {
    for (const cleanup of this.roomCleanup.splice(0)) cleanup();
    this.room = undefined;
  }

  private receive(type: string, payload: unknown): void {
    const candidate =
      payload !== null && typeof payload === 'object'
        ? { t: type, ...(payload as Record<string, unknown>) }
        : { t: type };
    const parsed = RoomServerMessageSchema.safeParse(candidate);
    if (parsed.success) {
      const message = parsed.data;
      if (message.t === 'match.pause') {
        this.cancelMatchResume();
        this.store.setState({ matchPause: { by: message.by, name: message.name, resumeAt: 0 } });
        return;
      }
      if (message.t === 'match.resume') {
        const current = this.store.getState().matchPause;
        if (current !== undefined) this.store.setState({ matchPause: { ...current, resumeAt: message.at } });
        if (current !== undefined) this.scheduleMatchResume(message.at);
        return;
      }
      if (message.t === 'match.resumed') {
        this.cancelMatchResume();
        this.store.setState({ matchPause: undefined });
        return;
      }
      if (message.t.startsWith('net.')) {
        if (!this.welcomed) return;
        for (const listener of this.netListeners) listener(message as NetServerMessage);
        return;
      }
    }
    /* Accepts a protocol-1 or protocol-2 frame and hands the editor the v1 view of it. */
    const message = serverMessageV1(candidate);
    if (message === undefined) return;
    this.acceptMessage(message, true);
    if (parsed.success && parsed.data.t === 'welcome') this.syncMatchState(parsed.data.state);
  }

  private acceptMessage(message: ServerMessage, record: boolean): void {
    if (record) this.receivedMessages.push(message);
    if (this.receivedMessages.length > receivedLimit)
      this.receivedMessages.splice(0, this.receivedMessages.length - receivedLimit);

    if (message.t === 'welcome' && this.welcomed) return;

    switch (message.t) {
      case 'welcome':
        this.welcomed = true;
        this.store.getState().welcome(message.you, message.state);
        this.startPing();
        break;
      case 'pong':
        {
          const now = this.now();
          const rtt = Math.max(0, now - message.c);
          this.store.getState().setRtt(rtt);
          if (this.bestPingRtt === undefined || rtt < this.bestPingRtt) {
            this.bestPingRtt = rtt;
            this.store.setState({ serverOffsetMs: message.s - (message.c + rtt / 2) });
          }
        }
        break;
      case 'ended':
        this.store.getState().end(message.reason);
        this.clearTimers();
        break;
      default:
        break;
    }
    for (const listener of this.listeners) listener(message);
  }

  private syncMatchState(raw: unknown): void {
    const parsed = RoomStateV2Schema.safeParse(raw);
    if (!parsed.success) return;
    const { matchPausedBy, matchPauseName, matchResumeAt } = parsed.data;
    this.store.setState({
      matchPause: matchPausedBy
        ? { by: matchPausedBy, name: matchPauseName || matchPausedBy, resumeAt: matchResumeAt ?? 0 }
        : undefined,
    });
    if (matchPausedBy && matchResumeAt) this.scheduleMatchResume(matchResumeAt);
    else this.cancelMatchResume();
    const { seats, spectators, epoch } = parsed.data;
    const fingerprint = JSON.stringify({ seats, spectators, epoch });
    if (fingerprint !== this.seatsFingerprint) {
      this.seatsFingerprint = fingerprint;
      const message: NetServerMessage = { t: 'net.seats', seats, spectators, epoch };
      for (const listener of this.netListeners) listener(message);
    }
  }

  private scheduleMatchResume(at: number): void {
    this.cancelMatchResume();
    const delay = Math.max(0, at - (this.now() + (this.store.getState().serverOffsetMs ?? 0)));
    this.matchResumeTimer = setTimeout(() => {
      this.matchResumeTimer = undefined;
      if (this.store.getState().matchPause?.resumeAt === at) this.store.setState({ matchPause: undefined });
    }, delay);
  }

  private cancelMatchResume(): void {
    if (this.matchResumeTimer !== undefined) clearTimeout(this.matchResumeTimer);
    this.matchResumeTimer = undefined;
  }

  private async reconnect(token: string, operationId: number): Promise<void> {
    if (!this.isCurrent(operationId) || this.reconnectingOperationId === operationId) return;
    this.reconnectingOperationId = operationId;
    this.store.getState().connection('reconnecting');
    try {
      for (const delay of reconnectDelays) {
        if (delay > 0) await wait(delay);
        if (!this.isCurrent(operationId) || this.consentedLeave || this.store.getState().status === 'ended') return;
        try {
          const room = await this.transport.reconnect(token);
          if (!this.isCurrent(operationId) || this.consentedLeave) {
            await discardRoom(room);
            return;
          }
          this.attachRoom(room, true, operationId);
          return;
        } catch {
          // The bounded retry loop falls back to a fresh grant below.
        }
      }
      if (await this.refreshGrant(operationId)) {
        this.store.getState().connection('connecting');
        await this.joinCurrent(true, operationId);
      } else if (this.isCurrent(operationId)) {
        this.store.getState().reject({ code: 'GRANT_INVALID' });
      }
    } finally {
      if (this.reconnectingOperationId === operationId) this.reconnectingOperationId = undefined;
    }
  }

  private scheduleGrantRefresh(expiresAt: number, operationId: number): void {
    if (this.grantTimer !== undefined) clearTimeout(this.grantTimer);
    const delay = Math.max(0, asEpochMs(expiresAt) - this.now() - 60_000);
    this.grantTimer = setTimeout(() => void this.refreshGrant(operationId), delay);
  }

  private async refreshGrant(operationId: number): Promise<boolean> {
    if (!this.isCurrent(operationId)) return false;
    if (this.refreshInFlight?.operationId === operationId) return this.refreshInFlight.promise;
    const promise = this.performGrantRefresh(operationId).finally(() => {
      if (this.refreshInFlight?.promise === promise) this.refreshInFlight = undefined;
    });
    this.refreshInFlight = { operationId, promise };
    return promise;
  }

  private async performGrantRefresh(operationId: number): Promise<boolean> {
    if (!this.isCurrent(operationId)) return false;
    const current = this.credentials;
    if (current === undefined) return false;
    try {
      const next = await this.fetchGrant(current.roomId);
      if (!this.isCurrent(operationId)) return false;
      this.credentials = { roomId: current.roomId, ...next };
      if (asEpochMs(next.expiresAt) > asEpochMs(current.expiresAt)) {
        this.scheduleGrantRefresh(next.expiresAt, operationId);
      }
      return true;
    } catch {
      return false;
    }
  }

  private startPing(): void {
    if (this.pingTimer !== undefined) return;
    this.send({ t: 'ping', c: this.now() });
    this.schedulePing();
    this.pingPhaseUnsubscribe = this.store.subscribe((next, previous) => {
      if (next.phase !== previous.phase) this.schedulePing();
    });
  }

  /**
   * A chained timeout rather than an interval, so the cadence follows the phase: the transport estimator needs samples
   * at 1 Hz while a match runs, and the room's own `ping` bucket (10/s) is far above four seats at that rate.
   */
  private schedulePing(): void {
    if (this.pingTimer !== undefined) clearTimeout(this.pingTimer);
    const delay = this.pingInterval(this.store.getState().phase);
    this.pingTimer = setTimeout(() => {
      this.pingTimer = undefined;
      this.send({ t: 'ping', c: this.now() });
      this.schedulePing();
    }, delay);
  }

  private clearTimers(): void {
    this.cancelMatchResume();
    if (this.grantTimer !== undefined) clearTimeout(this.grantTimer);
    if (this.pingTimer !== undefined) clearTimeout(this.pingTimer);
    this.grantTimer = undefined;
    this.pingTimer = undefined;
    this.pingPhaseUnsubscribe?.();
    this.pingPhaseUnsubscribe = undefined;
  }

  private warnOnce(type: RoomClientMessage['t']): void {
    if (this.warned.has(type)) return;
    this.warned.add(type);
    console.warn(`Dropped oversized or invalid room ${type} message`);
  }

  private isCurrent(operationId: number): boolean {
    return this.operationId === operationId;
  }

  private isAttached(room: RoomTransport, operationId: number): boolean {
    return this.isCurrent(operationId) && this.room === room;
  }
}

async function fetchRoomGrant(roomId: string): Promise<RoomGrant> {
  return api<RoomGrant>(`/rooms/${encodeURIComponent(roomId)}/grant`);
}

function parseJoinRejection(error: unknown) {
  if (error instanceof Error) {
    try {
      const start = error.message.indexOf('{');
      const end = error.message.lastIndexOf('}');
      const source = start >= 0 && end >= start ? error.message.slice(start, end + 1) : error.message;
      const parsed = JoinRejectionSchema.safeParse(JSON.parse(source));
      if (parsed.success) return parsed.data;
    } catch {
      // Deliberately fall through without retaining or reporting the source message.
    }
  }
  return { code: 'GRANT_INVALID' as const };
}

function exceedsClientLimit(message: RoomClientMessage): boolean {
  switch (message.t) {
    case 'input':
      return encoder.encode(JSON.stringify(message.f)).byteLength > LIMITS.inputBytes;
    case 'snapshot':
      return message.data.byteLength > LIMITS.snapshotBytes;
    case 'event':
      return message.data.byteLength > LIMITS.eventBytes;
    case 'design.tx':
      return encoder.encode(JSON.stringify(message.tx)).byteLength > LIMITS.designTxBytes;
    default:
      return false;
  }
}

function defaultPingInterval(phase?: Phase): number {
  return phase === 'playing' ? 1_000 : 5_000;
}

function asEpochMs(expiresAt: number): number {
  return expiresAt < 10_000_000_000 ? expiresAt * 1_000 : expiresAt;
}

function toJson(value: unknown): unknown {
  if (value !== null && typeof value === 'object' && 'toJSON' in value && typeof value.toJSON === 'function') {
    return value.toJSON();
  }
  return value;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function discardRoom(room: RoomTransport): Promise<void> {
  try {
    await room.leave(true);
  } catch {
    // Best-effort cleanup for a stale session must not change the current room lifecycle.
  }
}
