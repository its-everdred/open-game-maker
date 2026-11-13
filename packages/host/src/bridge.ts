import {
  SDK_PROTOCOL,
  envelope,
  gameToHostSchema,
  hostToGameSchema,
  type Envelope,
  type GameToHost,
  type HostToGame,
} from '@ogm/contracts/bridge';
import {
  BridgeError,
  openHostBridge,
  type Bridge,
  type HostBridgeOptions as TransportOptions,
} from '@ogm/iframe-bridge';
import { z } from 'zod';

export type Role = 'owner' | 'editor' | 'player' | 'watcher';
export type HostFailure = { code: string; message: string };
export type ReadyPayload = Extract<GameToHost, { t: 'ready' }>['payload'];

type HostType = Exclude<HostToGame['t'], 'hello'>;
type GameType = GameToHost['t'];
type HostPayload<T extends HostType> = Extract<HostToGame, { t: T }>['payload'];
type GamePayload<T extends GameType> = Extract<GameToHost, { t: T }>['payload'];
type TransportFactory = (iframe: HTMLIFrameElement, options: TransportOptions) => Bridge;

const gameHelloSchema = envelope('hello', z.looseObject({ protocol: z.number().int().min(1) }));
let nextMessageId = 0;

export interface HostBridgeOptions {
  iframe: HTMLIFrameElement;
  origin: string;
  opaqueOrigin?: boolean;
  hello: Extract<HostToGame, { t: 'hello' }>['payload'];
  role: () => Role;
  readyTimeoutMs?: number;
  requestTimeoutMs?: number;
  monitorIntervalMs?: number;
  now?: () => number;
  onFatal?: (failure: HostFailure) => void;
  transportFactory?: TransportFactory;
}

export function canApply(role: Role): boolean {
  return role === 'owner' || role === 'editor';
}

function parseInbound(raw: unknown): Envelope<string, unknown> | null {
  const message = gameToHostSchema.safeParse(raw);
  if (message.success) return message.data;
  const hello = gameHelloSchema.safeParse(raw);
  return hello.success ? hello.data : null;
}

export class HostBridge {
  readonly whenReady: Promise<ReadyPayload>;

  private readonly transport: Bridge;
  private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();
  private readonly errors = new Set<(failure: HostFailure) => void>();
  private readonly queued: HostToGame[] = [];
  private readonly recentDrops: number[] = [];
  private readonly now: () => number;
  private resolveReady!: (payload: ReadyPayload) => void;
  private rejectReady!: (error: Error) => void;
  private readyPayload: ReadyPayload | undefined;
  private readyTimer: ReturnType<typeof setTimeout> | undefined;
  private monitorTimer: ReturnType<typeof setInterval> | undefined;
  private observedDrops = 0;
  private closed = false;

  constructor(private readonly options: HostBridgeOptions) {
    this.now = options.now ?? (() => performance.now());
    this.whenReady = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    // Consumers may choose the event API instead of awaiting readiness. Keep a
    // later close from becoming an unhandled rejection in that valid usage.
    void this.whenReady.catch(() => undefined);
    const hello: Extract<HostToGame, { t: 'hello' }> = {
      v: 1,
      id: this.nextId(),
      t: 'hello',
      payload: options.hello,
    };
    const factory = options.transportFactory ?? openHostBridge;
    this.transport = factory(options.iframe, {
      gameOrigin: options.origin,
      ...(options.opaqueOrigin ? { opaqueOrigin: true } : {}),
      validate: parseInbound,
      onMessage: (message) => this.receive(message),
      hello,
    });
    void this.transport.ready.catch((error: unknown) => {
      if (!this.closed) {
        this.fatal('bridge-connect', error instanceof Error ? error.message : 'bridge connection failed');
      }
    });
    const timeoutMs = options.readyTimeoutMs ?? 30_000;
    this.readyTimer = setTimeout(() => this.fatal('ready-timeout', 'game did not become ready in time'), timeoutMs);
    const monitorIntervalMs = options.monitorIntervalMs ?? 250;
    if (monitorIntervalMs > 0) {
      this.monitorTimer = setInterval(() => this.monitorDrops(), monitorIntervalMs);
    }
  }

  get dropped(): number {
    const dropped = this.transport.stats().dropped;
    return dropped.invalid + dropped.rateLimited + dropped.tooLarge;
  }

  send<T extends HostType>(type: T, payload: HostPayload<T>): boolean {
    if ((type === 'design.apply' || type === 'mode.set') && !canApply(this.options.role())) {
      this.report({ code: 'forbidden', message: `${type} is not allowed for the current role` });
      return false;
    }
    const parsed = hostToGameSchema.safeParse({ v: 1, id: this.nextId(), t: type, payload });
    if (!parsed.success) throw new TypeError(`invalid ${type} payload`);
    if (!this.readyPayload) {
      this.queued.push(parsed.data);
      return true;
    }
    this.transport.send(parsed.data);
    return true;
  }

  async request<T extends Extract<HostType, `test.${string}`>>(type: T, payload: HostPayload<T>): Promise<unknown> {
    if (!this.readyPayload) throw new BridgeError('not_ready');
    const parsed = hostToGameSchema.safeParse({ v: 1, id: this.nextId(), t: type, payload });
    if (!parsed.success) throw new TypeError(`invalid ${type} payload`);
    const reply = await this.transport.request<Envelope<string, unknown>>(
      parsed.data,
      this.options.requestTimeoutMs ?? 10_000,
    );
    const result = gameToHostSchema.safeParse(reply);
    if (!result.success || result.data.t !== 'test.result') throw new TypeError('invalid test.result reply');
    if (!result.data.payload.ok) throw new Error(result.data.payload.error ?? 'test request failed');
    return result.data.payload.value;
  }

  on<T extends GameType>(type: T, callback: (payload: GamePayload<T>) => void): () => void {
    const callbacks = this.handlers.get(type) ?? new Set();
    callbacks.add(callback as (payload: unknown) => void);
    this.handlers.set(type, callbacks);
    return () => callbacks.delete(callback as (payload: unknown) => void);
  }

  onError(callback: (failure: HostFailure) => void): () => void {
    this.errors.add(callback);
    return () => this.errors.delete(callback);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.readyTimer) clearTimeout(this.readyTimer);
    if (this.monitorTimer) clearInterval(this.monitorTimer);
    this.transport.close();
    if (!this.readyPayload) this.rejectReady(new BridgeError('closed'));
    this.handlers.clear();
    this.errors.clear();
    this.queued.length = 0;
  }

  private receive(message: Envelope<string, unknown>): void {
    if (this.closed || message.t === 'hello') return;
    const parsed = gameToHostSchema.safeParse(message);
    if (!parsed.success) return;
    if (parsed.data.t === 'ready') {
      if (parsed.data.payload.protocol !== SDK_PROTOCOL) {
        return this.fatal('protocol-mismatch', `expected protocol ${SDK_PROTOCOL}`);
      }
      if (this.readyPayload) return;
      this.readyPayload = parsed.data.payload;
      if (this.readyTimer) clearTimeout(this.readyTimer);
      this.resolveReady(parsed.data.payload);
      for (const queued of this.queued.splice(0)) this.transport.send(queued);
    }
    if (parsed.data.t === 'error') this.report(parsed.data.payload);
    for (const callback of this.handlers.get(parsed.data.t) ?? []) callback(parsed.data.payload);
  }

  private monitorDrops(): void {
    const total = this.dropped;
    const added = Math.max(0, total - this.observedDrops);
    this.observedDrops = total;
    const now = this.now();
    for (let index = 0; index < added; index += 1) this.recentDrops.push(now);
    while (this.recentDrops[0] !== undefined && now - this.recentDrops[0] > 10_000) this.recentDrops.shift();
    if (this.recentDrops.length >= 10) this.fatal('bridge-abuse', 'bridge limits were breached repeatedly');
  }

  private fatal(code: string, message: string): void {
    if (this.closed) return;
    const failure = { code, message };
    try {
      this.report(failure);
    } finally {
      try {
        this.options.onFatal?.(failure);
      } finally {
        this.close();
      }
    }
  }

  private report(failure: HostFailure): void {
    for (const callback of this.errors) callback(failure);
  }

  private nextId(): string {
    nextMessageId += 1;
    return `host-${nextMessageId}`;
  }
}
