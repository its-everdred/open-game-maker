import { MAX_PLAYERS, type ActionFrame, type ActionValue, type RigInputMapping } from '@ogm/contracts/input';

import { KeyboardInput, type RawKey } from './keyboard.js';
import { PointerInput } from './pointer.js';
import { TouchInput } from './touch.js';

type Source = ActionFrame['source'];
type Actions = Record<string, ActionValue>;

const sourceOrder: Source[] = ['network', 'touch', 'keyboard', 'pointer', 'gamepad'];

export interface InputBridge {
  on?(type: 'input.frame', listener: (frame: ActionFrame) => void): () => void;
  send(type: 'input.rawKey', payload: RawKey): void;
}

export interface InputMergerOptions {
  localPlayerIndex: number;
  mapping: RigInputMapping;
  canvas?: HTMLCanvasElement;
  bridge?: InputBridge;
  hotkeys?: string[];
  maxLocalPlayers?: number;
  pointerAim?: (clientX: number, clientY: number) => ActionValue | null;
  mapFrame?: (frame: ActionFrame) => ActionFrame;
}

function mergeInto(target: Actions, source: Actions): void {
  for (const [action, value] of Object.entries(source)) target[action] = structuredClone(value);
}

export class InputMerger {
  dropped = 0;
  private readonly held = new Map<number, Map<Source, Actions>>();
  private readonly transient = new Map<number, Map<Source, Actions>>();
  private readonly maxLocalPlayers: number;
  private readonly keyboard?: KeyboardInput;
  private readonly pointer?: PointerInput;
  private readonly touch?: TouchInput;
  private readonly cleanupBridge?: () => void;
  private localPlayerIndex: number;

  constructor(private readonly options: InputMergerOptions) {
    this.maxLocalPlayers = Math.min(MAX_PLAYERS, options.maxLocalPlayers ?? 4);
    this.localPlayerIndex = options.localPlayerIndex;
    if (!this.validPlayer(options.localPlayerIndex))
      throw new RangeError('localPlayerIndex is outside the local player count');
    if (options.bridge?.on)
      this.cleanupBridge = options.bridge.on('input.frame', (frame) => this.acceptHostFrame(frame));
    if (options.canvas) {
      this.keyboard = new KeyboardInput(
        options.canvas,
        options.mapping.keyboard,
        (actions) => this.setHeld(this.localPlayerIndex, 'keyboard', actions),
        (key) => options.bridge?.send('input.rawKey', key),
        options.hotkeys,
      );
      this.pointer = new PointerInput({
        canvas: options.canvas,
        pointerLock: options.mapping.pointerLock,
        emit: (actions) => this.addTransient(this.localPlayerIndex, 'pointer', actions),
        aim: options.pointerAim,
      });
      this.touch = new TouchInput(options.canvas, options.mapping.touch, (actions) =>
        this.addTransient(this.localPlayerIndex, 'touch', actions),
      );
    }
  }

  acceptHostFrame(frame: ActionFrame): void {
    if (!this.validPlayer(frame.playerIndex)) {
      this.dropped += 1;
      return;
    }
    this.setHeld(frame.playerIndex, frame.source, frame.actions);
  }

  setKeyboardMapping(mapping: RigInputMapping['keyboard']): void {
    this.keyboard?.setMapping(mapping);
  }

  inject(frame: ActionFrame): void {
    if (!this.validPlayer(frame.playerIndex)) {
      this.dropped += 1;
      return;
    }
    this.addTransient(frame.playerIndex, frame.source, frame.actions);
  }

  setLocalPlayerIndex(playerIndex: number): void {
    if (!this.validPlayer(playerIndex)) throw new RangeError('localPlayerIndex is outside the local player count');
    if (playerIndex === this.localPlayerIndex) return;
    const previousHeld = this.held.get(this.localPlayerIndex);
    previousHeld?.delete('keyboard');
    if (previousHeld?.size === 0) this.held.delete(this.localPlayerIndex);
    const previousTransient = this.transient.get(this.localPlayerIndex);
    previousTransient?.delete('keyboard');
    previousTransient?.delete('pointer');
    previousTransient?.delete('touch');
    if (previousTransient?.size === 0) this.transient.delete(this.localPlayerIndex);
    this.localPlayerIndex = playerIndex;
  }

  sample(tick: number): ActionFrame[] {
    const players = new Set<number>([this.localPlayerIndex, ...this.held.keys(), ...this.transient.keys()]);
    const frames = [...players]
      .sort((left, right) => left - right)
      .map((playerIndex): ActionFrame => {
        const actions: Actions = {};
        let source: Source = 'keyboard';
        let lookSource: Source | undefined;
        for (const candidate of sourceOrder) {
          const held = this.held.get(playerIndex)?.get(candidate);
          const transient = this.transient.get(playerIndex)?.get(candidate);
          if (held) mergeInto(actions, held);
          if (transient) mergeInto(actions, transient);
          if (held && 'look' in held) lookSource = candidate;
          if (transient && 'look' in transient) lookSource = candidate;
          if ((held && Object.keys(held).length > 0) || (transient && Object.keys(transient).length > 0))
            source = candidate;
        }
        const frame = { playerIndex, tick, source: lookSource ?? source, actions } satisfies ActionFrame;
        return this.options.mapFrame?.(frame) ?? frame;
      });
    this.transient.clear();
    return frames;
  }

  setPointerLock(enabled: boolean): void {
    this.pointer?.setPointerLock(enabled);
  }

  dispose(): void {
    this.keyboard?.dispose();
    this.pointer?.dispose();
    this.touch?.dispose();
    this.cleanupBridge?.();
    this.held.clear();
    this.transient.clear();
  }

  private validPlayer(playerIndex: number): boolean {
    return Number.isInteger(playerIndex) && playerIndex >= 0 && playerIndex < this.maxLocalPlayers;
  }

  private setHeld(playerIndex: number, source: Source, actions: Actions): void {
    const bySource = this.held.get(playerIndex) ?? new Map<Source, Actions>();
    bySource.set(source, structuredClone(actions));
    this.held.set(playerIndex, bySource);
  }

  private addTransient(playerIndex: number, source: Source, actions: Actions): void {
    const bySource = this.transient.get(playerIndex) ?? new Map<Source, Actions>();
    const current = bySource.get(source) ?? {};
    for (const [action, value] of Object.entries(actions)) {
      const previous = current[action];
      if (source === 'pointer' && action === 'look' && typeof previous === 'object' && typeof value === 'object') {
        current[action] = { x: previous.x + value.x, y: previous.y + value.y };
      } else {
        current[action] = structuredClone(value);
      }
    }
    bySource.set(source, current);
    this.transient.set(playerIndex, bySource);
  }
}
