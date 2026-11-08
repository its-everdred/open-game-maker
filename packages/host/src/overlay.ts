import type { GameManifest } from '@ogm/contracts/game';
import type { ActionFrame, ActionValue, RigInputMapping } from '@ogm/contracts/input';

type TouchMode = RigInputMapping['touch'];

const EDGE = 24;
const STICK_SIZE = 100;
const BUTTON_PITCH = 76;

/** `rotateCCW` → `Rotate CCW`, `soft_drop` → `Soft drop`: what a player hears, never the raw id. */
export function actionLabel(action: string): string {
  const words = action
    .replace(/[_-]+/gu, ' ')
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .trim()
    .split(/\s+/u)
    .map((word) => (word === word.toUpperCase() ? word : word.toLowerCase()));
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** First match wins, so the narrower words (counter-clockwise, hard drop) come before the broader ones. */
const ICONS: [RegExp, string][] = [
  [/\bccw\b|counter|anti/u, '\u21BA'],
  [/rotate|turn|\bcw\b|spin/u, '\u21BB'],
  [/hard drop|slam/u, '\u2913'],
  [/drop|down|crouch/u, '\u2193'],
  [/jump|\bup\b/u, '\u2191'],
  [/\bleft\b/u, '\u2190'],
  [/\bright\b/u, '\u2192'],
  [/hold|swap/u, '\u21C4'],
  [/fire|shoot|attack/u, '\u2726'],
  [/pause/u, '\u23F8\uFE0E'],
];

/** A glyph for the action's own words, else the first letter of its spoken label; never the raw id. */
export function actionIcon(action: string): string {
  const label = actionLabel(action);
  const words = label.toLowerCase();
  return ICONS.find(([pattern]) => pattern.test(words))?.[1] ?? label.charAt(0);
}

export interface TouchOverlayOptions {
  layer: HTMLElement;
  inputs: GameManifest['inputs'];
  touch: TouchMode;
  playerIndex: number;
  onFrame: (frame: ActionFrame) => void;
  now?: () => number;
  coarsePointer?: () => boolean;
  window?: Window;
  document?: Document;
}

export class TouchOverlay {
  private readonly now: () => number;
  private readonly coarsePointer: () => boolean;
  private readonly hostWindow: Window;
  private readonly hostDocument: Document;
  private readonly actions: Record<string, ActionValue> = {};
  private inputs: GameManifest['inputs'];
  private touch: TouchMode;
  private enabled = true;
  private suppressedUntil = -Infinity;
  private showTimer: ReturnType<typeof setTimeout> | undefined;
  private keepaliveTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly options: TouchOverlayOptions) {
    this.inputs = options.inputs;
    this.touch = options.touch;
    this.now = options.now ?? (() => performance.now());
    this.hostWindow = options.window ?? window;
    this.hostDocument = options.document ?? document;
    this.coarsePointer =
      options.coarsePointer ?? (() => this.hostWindow.matchMedia?.('(pointer: coarse)').matches ?? false);
    Object.assign(options.layer.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    this.hostWindow.addEventListener('keydown', this.onKeydown);
    this.hostDocument.addEventListener('gesturestart', this.preventGesture, { passive: false });
    this.render();
  }

  setInputs(inputs: GameManifest['inputs'], touch: TouchMode): void {
    this.deactivate(true);
    this.inputs = inputs;
    this.touch = touch;
    for (const action of Object.keys(this.actions)) delete this.actions[action];
    this.render();
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled && !enabled) this.deactivate(true);
    this.enabled = enabled;
    this.refreshVisibility();
  }

  noteGamepadInput(at = this.now()): void {
    this.suppress(at);
  }

  noteKeyboardInput(at = this.now()): void {
    this.suppress(at);
  }

  dispose(): void {
    this.deactivate(false);
    this.hostWindow.removeEventListener('keydown', this.onKeydown);
    this.hostDocument.removeEventListener('gesturestart', this.preventGesture);
    if (this.showTimer) clearTimeout(this.showTimer);
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
    this.options.layer.replaceChildren();
  }

  private render(): void {
    const layer = this.options.layer;
    layer.replaceChildren();
    const entries = Object.entries(this.inputs.actions);
    if (this.touch === 'tap') return this.refreshVisibility();
    const sticks = entries.filter(([, kind]) => kind === 'stick').slice(0, this.touch === 'two-stick' ? 2 : 1);
    sticks.forEach(([action], index) => layer.append(this.createStick(action, index)));
    const buttons = entries.filter(([, kind]) => kind === 'button').slice(0, 5);
    if (entries.filter(([, kind]) => kind === 'button').length > 5) {
      console.warn('TouchOverlay supports at most five button actions');
    }
    /* With a stick in each corner the buttons sit above the right one, three across so they fit a landscape phone. */
    const aboveStick = this.touch === 'two-stick' && sticks.length > 1;
    const base = EDGE + (aboveStick ? STICK_SIZE + 12 : 0);
    const columns = aboveStick ? 3 : 2;
    buttons.forEach(([action], index) => layer.append(this.createButton(action, index, base, columns)));
    this.refreshVisibility();
  }

  private createStick(action: string, index: number): HTMLElement {
    const stick = this.hostDocument.createElement('div');
    stick.dataset.stick = action;
    stick.setAttribute('role', 'button');
    stick.setAttribute('aria-label', actionLabel(action));
    Object.assign(stick.style, {
      position: 'absolute',
      left: index === 0 ? `${EDGE}px` : 'auto',
      right: index === 1 ? `${EDGE}px` : 'auto',
      bottom: `${EDGE}px`,
      width: `${STICK_SIZE}px`,
      height: `${STICK_SIZE}px`,
      borderRadius: '50%',
      pointerEvents: 'auto',
      touchAction: 'none',
    });
    const nub = this.hostDocument.createElement('span');
    nub.style.display = 'block';
    nub.style.width = '44px';
    nub.style.height = '44px';
    nub.style.margin = '28px';
    nub.style.borderRadius = '50%';
    stick.append(nub);
    let pointerId: number | undefined;
    let startX = 0;
    let startY = 0;
    const move = (event: PointerEvent) => {
      let x = event.clientX - startX;
      let y = event.clientY - startY;
      const magnitude = Math.hypot(x, y);
      if (magnitude > 50) {
        x *= 50 / magnitude;
        y *= 50 / magnitude;
      }
      this.actions[action] = { x: x / 50, y: y / 50 };
      nub.style.transform = `translate(${x}px, ${y}px)`;
      this.emit();
    };
    stick.addEventListener('pointerdown', (event) => {
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      try {
        stick.setPointerCapture(pointerId);
      } catch {
        // Some embedded browsers expose PointerEvent without pointer capture.
      }
      this.actions[action] = { x: 0, y: 0 };
      this.startKeepalive();
      this.emit();
    });
    stick.addEventListener('pointermove', (event) => {
      if (event.pointerId === pointerId) move(event);
    });
    const release = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      pointerId = undefined;
      this.actions[action] = { x: 0, y: 0 };
      nub.style.transform = '';
      this.emit();
      this.stopKeepaliveIfIdle();
    };
    stick.addEventListener('pointerup', release);
    stick.addEventListener('pointercancel', release);
    stick.addEventListener('touchstart', (event) => event.preventDefault(), { passive: false });
    return stick;
  }

  private createButton(action: string, index: number, base: number, columns: number): HTMLButtonElement {
    const button = this.hostDocument.createElement('button');
    button.type = 'button';
    button.dataset.action = action;
    button.setAttribute('aria-label', actionLabel(action));
    const size = index === 0 ? 64 : 44;
    const icon = this.hostDocument.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = actionIcon(action);
    icon.style.fontSize = `${Math.round(size * 0.45)}px`;
    icon.style.lineHeight = '1';
    button.append(icon);
    const inset = (64 - size) / 2;
    Object.assign(button.style, {
      position: 'absolute',
      right: `${EDGE + (index % columns) * BUTTON_PITCH + inset}px`,
      bottom: `${base + Math.floor(index / columns) * BUTTON_PITCH + inset}px`,
      width: `${size}px`,
      height: `${size}px`,
      display: 'grid',
      placeItems: 'center',
      padding: '0',
      borderRadius: '50%',
      pointerEvents: 'auto',
      touchAction: 'none',
    });
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      try {
        button.setPointerCapture?.(event.pointerId);
      } catch {
        // Match the stick fallback for browsers with partial pointer capture.
      }
      this.actions[action] = true;
      this.startKeepalive();
      this.emit();
    });
    const release = () => {
      this.actions[action] = false;
      this.emit();
      this.stopKeepaliveIfIdle();
    };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('touchstart', (event) => event.preventDefault(), { passive: false });
    return button;
  }

  private emit(): void {
    if (!this.enabled || this.now() < this.suppressedUntil) return;
    this.options.onFrame({
      playerIndex: this.options.playerIndex,
      tick: Math.max(0, Math.floor(this.now())),
      source: 'touch',
      actions: { ...this.actions },
    });
  }

  private suppress(at: number): void {
    this.deactivate(true);
    this.suppressedUntil = Math.max(this.suppressedUntil, at + 2_000);
    if (this.showTimer) clearTimeout(this.showTimer);
    this.showTimer = setTimeout(() => this.refreshVisibility(), Math.max(0, this.suppressedUntil - this.now()));
    this.refreshVisibility();
  }

  private refreshVisibility(): void {
    const hidden = !this.enabled || !this.coarsePointer() || this.now() < this.suppressedUntil;
    this.options.layer.hidden = hidden;
    this.options.layer.setAttribute('aria-hidden', String(hidden));
  }

  private startKeepalive(): void {
    if (this.keepaliveTimer) return;
    this.keepaliveTimer = setInterval(() => this.emit(), 250);
  }

  private deactivate(emitReset: boolean): void {
    let active = false;
    for (const [action, value] of Object.entries(this.actions)) {
      if (typeof value === 'boolean') {
        active ||= value;
        this.actions[action] = false;
      } else if (typeof value === 'number') {
        active ||= value !== 0;
        this.actions[action] = 0;
      } else {
        active ||= value.x !== 0 || value.y !== 0;
        this.actions[action] = { x: 0, y: 0 };
      }
    }
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = undefined;
    }
    if (active && emitReset) this.emit();
  }

  private stopKeepaliveIfIdle(): void {
    const active = Object.values(this.actions).some((value) =>
      typeof value === 'boolean' ? value : typeof value === 'number' ? value !== 0 : value.x !== 0 || value.y !== 0,
    );
    if (!active && this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = undefined;
    }
  }

  private readonly onKeydown = () => this.noteKeyboardInput();
  private readonly preventGesture = (event: Event) => event.preventDefault();
}
