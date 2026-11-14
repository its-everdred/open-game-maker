import type { ActionValue, RigInputMapping } from '@ogm/contracts';

const preventDefaultCodes = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
]);

export interface RawKey {
  code: string;
  down: boolean;
}

export class KeyboardInput {
  private readonly pressed = new Set<string>();
  private readonly hotkeys: Set<string>;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private mapping: RigInputMapping['keyboard'],
    private readonly onActions: (actions: Record<string, ActionValue>) => void,
    private readonly onRawKey: (key: RawKey) => void,
    hotkeys: Iterable<string> = ['Escape'],
  ) {
    this.hotkeys = new Set(hotkeys);
    this.hotkeys.add('Escape');
    if (canvas.tabIndex < 0) canvas.tabIndex = 0;
    canvas.addEventListener('keydown', this.onKeyDown);
    canvas.addEventListener('keyup', this.onKeyUp);
    canvas.addEventListener('blur', this.onBlur);
  }

  dispose(): void {
    this.canvas.removeEventListener('keydown', this.onKeyDown);
    this.canvas.removeEventListener('keyup', this.onKeyUp);
    this.canvas.removeEventListener('blur', this.onBlur);
  }

  setMapping(mapping: RigInputMapping['keyboard']): void {
    this.pressed.clear();
    this.mapping = { ...mapping };
    this.emit();
  }

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (
      (event.ctrlKey || event.altKey || event.metaKey) &&
      !/^(Control|Alt|Meta)(Left|Right)$/.test(event.code) &&
      !this.hotkeys.has(event.code)
    )
      return;
    if (preventDefaultCodes.has(event.code) || this.mapping[event.code]) event.preventDefault();
    if (this.hotkeys.has(event.code)) {
      this.onRawKey({ code: event.code, down: true });
      return;
    }
    if (!this.mapping[event.code]) return;
    this.pressed.add(event.code);
    this.emit();
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    if (preventDefaultCodes.has(event.code) || this.mapping[event.code]) event.preventDefault();
    if (this.hotkeys.has(event.code)) {
      this.onRawKey({ code: event.code, down: false });
      return;
    }
    if (!this.mapping[event.code]) return;
    this.pressed.delete(event.code);
    this.emit();
  };

  private readonly onBlur = () => {
    this.pressed.clear();
    this.emit();
  };

  private emit(): void {
    const actions: Record<string, ActionValue> = {};
    const vectors = new Map<string, { x: number; y: number }>();
    for (const code of this.pressed) {
      const action = this.mapping[code];
      if (!action) continue;
      const directional = /^(.*)\.(up|down|left|right)$/.exec(action);
      if (!directional) {
        actions[action] = true;
        continue;
      }
      const name = directional[1]!;
      const vector = vectors.get(name) ?? { x: 0, y: 0 };
      if (directional[2] === 'up') vector.y += 1;
      else if (directional[2] === 'down') vector.y -= 1;
      else if (directional[2] === 'left') vector.x -= 1;
      else vector.x += 1;
      vector.x = Math.max(-1, Math.min(1, vector.x));
      vector.y = Math.max(-1, Math.min(1, vector.y));
      vectors.set(name, vector);
    }
    for (const [name, vector] of vectors) actions[name] = vector;
    this.onActions(actions);
  }
}
