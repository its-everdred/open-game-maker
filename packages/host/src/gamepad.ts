import type { GameManifest } from '@ogm/contracts/game';
import { MAX_PLAYERS, type ActionFrame, type ActionValue } from '@ogm/contracts/input';

export type GamepadMapping = Record<string, string>;
export type ActionKinds = GameManifest['inputs']['actions'];
export type PadSnapshot = {
  playerIndex: number;
  deviceIndex: number;
  buttons: number[];
  axes: number[];
  timestamp: number;
};

type FrameCallback = (frame: ActionFrame) => void;
type SnapshotCallback = (snapshot: PadSnapshot) => void;

export interface GamepadPollerOptions {
  getGamepads?: () => readonly (Gamepad | null)[];
  raf?: (callback: FrameRequestCallback) => number;
  cancelRaf?: (handle: number) => void;
  now?: () => number;
  onActivity?: (at: number) => void;
}

const BUTTONS: Record<string, number> = {
  a: 0,
  b: 1,
  x: 2,
  y: 3,
  lb: 4,
  rb: 5,
  lt: 6,
  rt: 7,
  select: 8,
  start: 9,
};

export function defaultGamepadMapping(actions: ActionKinds): GamepadMapping {
  const mapping: GamepadMapping = Object.create(null) as GamepadMapping;
  const sticks = ['leftStick', 'rightStick'];
  const buttons = ['a', 'x', 'b', 'y', 'lb', 'rb'];
  let stick = 0;
  let button = 0;
  for (const [action, kind] of Object.entries(actions)) {
    if (kind === 'stick') mapping[action] = sticks[Math.min(stick++, sticks.length - 1)]!;
    else if (kind === 'button') mapping[action] = buttons[Math.min(button++, buttons.length - 1)]!;
  }
  return mapping;
}

export class GamepadPoller {
  lastInputAt = -Infinity;

  private readonly frameCallbacks = new Set<FrameCallback>();
  private readonly snapshotCallbacks = new Set<SnapshotCallback>();
  private readonly claims = new Map<number, number>();
  private readonly blocked = new Map<number, Set<string>>();
  private readonly previous = new Map<number, { actions: Record<string, ActionValue>; sentAt: number }>();
  private readonly getGamepads: () => readonly (Gamepad | null)[];
  private readonly raf: (callback: FrameRequestCallback) => number;
  private readonly cancelRaf: (handle: number) => void;
  private readonly now: () => number;
  private mapping: GamepadMapping = {};
  private actions: ActionKinds = {};
  private mode: 'play' | 'edit' = 'play';
  private rafHandle: number | undefined;

  constructor(private readonly options: GamepadPollerOptions = {}) {
    this.getGamepads = options.getGamepads ?? (() => navigator.getGamepads?.() ?? []);
    this.raf = options.raf ?? window.requestAnimationFrame.bind(window);
    this.cancelRaf = options.cancelRaf ?? window.cancelAnimationFrame.bind(window);
    this.now = options.now ?? (() => performance.now());
  }

  setMapping(mapping: GamepadMapping | undefined, actions: ActionKinds, contextChanged = false): void {
    const nextMapping = { ...defaultGamepadMapping(actions), ...mapping };
    if (
      !contextChanged &&
      JSON.stringify(this.actions) === JSON.stringify(actions) &&
      JSON.stringify(this.mapping) === JSON.stringify(nextMapping)
    )
      return;
    // Release the previous context before a physical button can acquire a new meaning.
    for (const [playerIndex, previous] of this.previous) {
      const neutral = this.neutralActions(previous.actions);
      const blocked = this.blocked.get(playerIndex) ?? new Set<string>();
      for (const [action, value] of Object.entries(previous.actions)) {
        const binding = this.mapping[action];
        if (binding && this.active(value)) blocked.add(binding);
      }
      if (blocked.size) this.blocked.set(playerIndex, blocked);
      if (this.mode === 'play') {
        const frame: ActionFrame = {
          playerIndex,
          tick: Math.max(0, Math.floor(this.now())),
          source: 'gamepad',
          cancelPending: true,
          actions: neutral,
        };
        for (const callback of this.frameCallbacks) callback(frame);
      }
    }
    this.previous.clear();
    this.actions = actions;
    this.mapping = nextMapping;
  }

  setMode(mode: 'play' | 'edit'): void {
    this.mode = mode;
  }

  onFrame(callback: FrameCallback): () => void {
    this.frameCallbacks.add(callback);
    return () => this.frameCallbacks.delete(callback);
  }

  onPadSnapshot(callback: SnapshotCallback): () => void {
    this.snapshotCallbacks.add(callback);
    return () => this.snapshotCallbacks.delete(callback);
  }

  start(): void {
    if (this.rafHandle !== undefined) return;
    const loop = () => {
      this.poll();
      this.rafHandle = this.raf(loop);
    };
    this.rafHandle = this.raf(loop);
  }

  stop(): void {
    if (this.rafHandle === undefined) return;
    this.cancelRaf(this.rafHandle);
    this.rafHandle = undefined;
  }

  poll(at = this.now()): void {
    const pads = Array.from(this.getGamepads());
    const connected = new Set(pads.filter((pad) => pad?.connected).map((pad) => pad!.index));
    for (const [deviceIndex, playerIndex] of this.claims) {
      if (connected.has(deviceIndex)) continue;
      const previous = this.previous.get(playerIndex);
      if (this.mode === 'play' && previous) {
        const actions = this.neutralActions(previous.actions);
        if (!this.sameActions(previous.actions, actions)) {
          const frame: ActionFrame = { playerIndex, tick: Math.max(0, Math.floor(at)), source: 'gamepad', actions };
          for (const callback of this.frameCallbacks) callback(frame);
        }
      }
      this.claims.delete(deviceIndex);
      this.previous.delete(playerIndex);
      this.blocked.delete(playerIndex);
    }
    for (const pad of pads) {
      if (!pad?.connected) continue;
      if (!this.claims.has(pad.index) && this.anyButtonPressed(pad)) this.claim(pad.index);
      const playerIndex = this.claims.get(pad.index);
      if (playerIndex === undefined) continue;
      const snapshot = this.snapshot(pad, playerIndex);
      if (this.anyButtonPressed(pad) || pad.axes.some((value) => Math.abs(value) > 0.15)) {
        this.lastInputAt = at;
        this.options.onActivity?.(at);
      }
      if (this.mode === 'edit') {
        for (const callback of this.snapshotCallbacks) callback(snapshot);
        continue;
      }
      const actions = this.mapActions(pad, playerIndex);
      const previous = this.previous.get(playerIndex);
      if (previous && this.sameActions(previous.actions, actions) && at - previous.sentAt < 250) continue;
      this.previous.set(playerIndex, { actions, sentAt: at });
      const frame: ActionFrame = { playerIndex, tick: Math.max(0, Math.floor(at)), source: 'gamepad', actions };
      for (const callback of this.frameCallbacks) callback(frame);
    }
  }

  private claim(deviceIndex: number): void {
    const used = new Set(this.claims.values());
    for (let playerIndex = 0; playerIndex < MAX_PLAYERS; playerIndex += 1) {
      if (!used.has(playerIndex)) {
        this.claims.set(deviceIndex, playerIndex);
        return;
      }
    }
  }

  private mapActions(pad: Gamepad, playerIndex: number): Record<string, ActionValue> {
    const values: Record<string, ActionValue> = Object.create(null) as Record<string, ActionValue>;
    const blocked = this.blocked.get(playerIndex);
    for (const binding of blocked ?? []) {
      const kind = binding === 'leftStick' || binding === 'rightStick' || binding === 'dpad' ? 'stick' : 'button';
      if (!this.active(this.readBinding(pad, binding, kind))) blocked!.delete(binding);
    }
    for (const [action, kind] of Object.entries(this.actions)) {
      const binding = this.mapping[action];
      if (!binding) continue;
      const value = this.readBinding(pad, binding, kind);
      if (blocked?.has(binding)) {
        values[action] = this.neutralActions({ [action]: value })[action]!;
      } else values[action] = value;
    }
    return values;
  }

  private active(value: ActionValue): boolean {
    return typeof value === 'boolean'
      ? value
      : typeof value === 'number'
        ? value !== 0
        : value.x !== 0 || value.y !== 0;
  }

  private readBinding(pad: Gamepad, binding: string, kind: ActionKinds[string]): ActionValue {
    if (binding === 'leftStick' || binding === 'rightStick') {
      const offset = binding === 'leftStick' ? 0 : 2;
      const x = this.deadZone(pad.axes[offset] ?? 0);
      const y = this.deadZone(pad.axes[offset + 1] ?? 0);
      return kind === 'axis' ? x : { x, y };
    }
    if (binding === 'dpad') {
      return {
        x: Number(pad.buttons[15]?.pressed ?? false) - Number(pad.buttons[14]?.pressed ?? false),
        y: Number(pad.buttons[13]?.pressed ?? false) - Number(pad.buttons[12]?.pressed ?? false),
      };
    }
    const button = pad.buttons[BUTTONS[binding] ?? -1];
    return kind === 'axis' ? (button?.value ?? 0) : (button?.pressed ?? false);
  }

  private snapshot(pad: Gamepad, playerIndex: number): PadSnapshot {
    return {
      playerIndex,
      deviceIndex: pad.index,
      buttons: pad.buttons.map((button) => button.value),
      axes: [...pad.axes],
      timestamp: pad.timestamp,
    };
  }

  private anyButtonPressed(pad: Gamepad): boolean {
    return pad.buttons.some((button) => button.pressed || button.value > 0.5);
  }

  private deadZone(value: number): number {
    return Math.abs(value) < 0.15 ? 0 : value;
  }

  private sameActions(left: Record<string, ActionValue>, right: Record<string, ActionValue>): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  private neutralActions(actions: Record<string, ActionValue>): Record<string, ActionValue> {
    return Object.fromEntries(
      Object.entries(actions).map(([action, value]) => [
        action,
        typeof value === 'boolean' ? false : typeof value === 'number' ? 0 : { x: 0, y: 0 },
      ]),
    );
  }
}
