import type { GameManifest } from '@ogm/contracts/game';
import type { ActionFrame, ActionValue, ControlsLayout, RigInputMapping, TouchIcon } from '@ogm/contracts/input';

import { iconForWords, TOUCH_ICON_SVG } from './touch-icons.js';

type TouchMode = RigInputMapping['touch'];

const EDGE = 24;
const STICK_SIZE = 100;
const BUTTON_PITCH = 76;
/* What `@gm/sdk/menu` reads: the first stick moves focus, the first button confirms and the third goes back. */
const MENU_BUTTONS = [0, 2];

const LANDSCAPE_CSS = `
@media (orientation: landscape) {
  [data-ogm-dpad] { left: 8px !important; bottom: 8px !important; }
  [data-ogm-compact-button] { right: var(--ogm-landscape-right) !important; bottom: var(--ogm-landscape-bottom) !important; }
}`;

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

/** The game's declared icon for a button, else one picked from the action's words; never a letter or the raw id. */
export function actionIcon(action: string, declared?: GameManifest['inputs']['icons']): TouchIcon {
  return (
    (declared && Object.hasOwn(declared, action) ? declared[action] : undefined) ?? iconForWords(actionLabel(action))
  );
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
  private layout: ControlsLayout = 'gameplay';
  private loading = false;
  private outsideMenu: HTMLElement[] = [];
  private suppressedUntil = -Infinity;
  private showTimer: ReturnType<typeof setTimeout> | undefined;
  private keepaliveTimer: ReturnType<typeof setInterval> | undefined;
  private clearDpadPointers: (() => void) | undefined;

  constructor(private readonly options: TouchOverlayOptions) {
    this.inputs = options.inputs;
    this.touch = options.touch;
    this.now = options.now ?? (() => performance.now());
    this.hostWindow = options.window ?? window;
    this.hostDocument = options.document ?? document;
    this.coarsePointer =
      options.coarsePointer ?? (() => this.hostWindow.matchMedia?.('(pointer: coarse)').matches ?? false);
    if (!this.hostDocument.getElementById('ogm-touch-landscape-style')) {
      const style = this.hostDocument.createElement('style');
      style.id = 'ogm-touch-landscape-style';
      style.textContent = LANDSCAPE_CSS;
      this.hostDocument.head.append(style);
    }
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

  /** The game's choice for its current screen; `menu` keeps only what a menu reads, in the same places. */
  setLayout(layout: ControlsLayout): void {
    if (layout === this.layout) return;
    this.deactivate(true);
    this.layout = layout;
    if (this.inputs.controls) this.render();
    else {
      this.applyLayout();
      this.refreshVisibility();
    }
  }

  /** Hidden while the game has not drawn its first frame. */
  setLoading(loading: boolean): void {
    if (loading) this.deactivate(true);
    this.loading = loading;
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
    this.clearDpadPointers = undefined;
    this.outsideMenu = [];
    const controls = this.inputs.controls;
    const selected = controls && Object.hasOwn(controls, this.layout) ? controls[this.layout] : undefined;
    if (this.inputs.controls && !selected) return this.refreshVisibility();
    const entries = Object.entries(this.inputs.actions);
    if (!selected && this.touch === 'tap') return this.refreshVisibility();
    const sticks = selected
      ? [selected.stick, ...(selected.layout === 'two-stick' ? [selected.secondStick] : [])].filter(
          (action): action is string => !!action && this.inputs.actions[action] === 'stick',
        )
      : entries
          .filter(([, kind]) => kind === 'stick')
          .slice(0, this.touch === 'two-stick' ? 2 : 1)
          .map(([action]) => action);
    if (selected?.layout !== 'tap')
      sticks.forEach((action, index) => {
        const stick = selected?.layout === 'dpad' ? this.createDpad(action) : this.createStick(action, index);
        if (!selected && index > 0) this.outsideMenu.push(stick);
        layer.append(stick);
      });
    const buttons = selected
      ? selected.buttons
          .filter((button) => this.inputs.actions[button.action] === 'button')
          .map((button) => [button.action, button] as const)
      : entries
          .filter(([, kind]) => kind === 'button')
          .slice(0, 5)
          .map(([action]) => [action, undefined] as const);
    const aboveStick =
      (selected?.layout === 'two-stick' || (!selected && this.touch === 'two-stick')) && sticks.length > 1;
    const base = EDGE + (aboveStick ? STICK_SIZE + 12 : 0);
    const columns = aboveStick ? 3 : 2;
    buttons.forEach(([action, declaration], index) => {
      const button = this.createButton(action, index, base, columns, declaration);
      if (!aboveStick) button.dataset.ogmCompactButton = '';
      if (!selected && !MENU_BUTTONS.includes(index)) this.outsideMenu.push(button);
      layer.append(button);
    });
    this.applyLayout();
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
      transform:
        index === 0
          ? 'translate(env(safe-area-inset-left, 0px), calc(-1 * env(safe-area-inset-bottom, 0px)))'
          : 'translate(calc(-1 * env(safe-area-inset-right, 0px)), calc(-1 * env(safe-area-inset-bottom, 0px)))',
      width: `${STICK_SIZE}px`,
      height: `${STICK_SIZE}px`,
      borderRadius: '50%',
      background: 'rgba(0, 0, 0, 0.35)',
      border: '1px solid rgba(255, 255, 255, 0.6)',
      pointerEvents: 'auto',
      touchAction: 'none',
    });
    const nub = this.hostDocument.createElement('span');
    nub.style.display = 'block';
    nub.style.width = '44px';
    nub.style.height = '44px';
    nub.style.margin = '28px';
    nub.style.borderRadius = '50%';
    nub.style.background = 'rgba(255, 255, 255, 0.6)';
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
      if (!this.shown(stick)) return;
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
      /* A layout change hides the stick under a thumb that keeps dragging; it must not steer anything. */
      if (event.pointerId === pointerId && this.shown(stick)) move(event);
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

  private createDpad(action: string): HTMLElement {
    const pad = this.hostDocument.createElement('div');
    pad.dataset.stick = action;
    pad.dataset.dpad = '';
    pad.dataset.ogmDpad = '';
    pad.setAttribute('role', 'group');
    pad.setAttribute('aria-label', actionLabel(action));
    Object.assign(pad.style, {
      position: 'absolute',
      left: `${EDGE}px`,
      bottom: `${EDGE}px`,
      transform: 'translate(env(safe-area-inset-left, 0px), calc(-1 * env(safe-area-inset-bottom, 0px)))',
      width: '132px',
      height: '132px',
      pointerEvents: 'auto',
      touchAction: 'none',
    });
    const directions = [
      { name: 'up', x: 0, y: -1, left: 44, top: 0, icon: 'jump' },
      { name: 'left', x: -1, y: 0, left: 0, top: 44, icon: 'left' },
      { name: 'right', x: 1, y: 0, left: 88, top: 44, icon: 'right' },
      { name: 'down', x: 0, y: 1, left: 44, top: 88, icon: 'down' },
    ] as const;
    const active = new Map<number, (typeof directions)[number] | undefined>();
    this.clearDpadPointers = () => active.clear();
    const update = () => {
      let x = 0,
        y = 0;
      for (const direction of active.values()) {
        if (!direction) continue;
        x += direction.x;
        y += direction.y;
      }
      this.actions[action] = { x: Math.sign(x), y: Math.sign(y) };
      this.emit();
    };
    for (const direction of directions) {
      const button = this.hostDocument.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', `${actionLabel(action)} ${direction.name}`);
      button.dataset.direction = direction.name;
      button.innerHTML = TOUCH_ICON_SVG[direction.icon];
      Object.assign(button.style, {
        position: 'absolute',
        left: `${direction.left}px`,
        top: `${direction.top}px`,
        width: '44px',
        height: '44px',
        padding: '5px',
        color: 'white',
        border: '1px solid rgba(255, 255, 255, 0.6)',
        borderRadius: '6px',
        background: 'rgba(0, 0, 0, 0.35)',
        touchAction: 'none',
      });
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        if (!this.shown(pad)) return;
        try {
          button.setPointerCapture(event.pointerId);
        } catch {
          /* Partial pointer capture support. */
        }
        active.set(event.pointerId, direction);
        this.startKeepalive();
        update();
      });
      button.addEventListener('pointermove', (event) => {
        if (!active.has(event.pointerId) || !this.shown(pad)) return;
        const hit = this.hostDocument.elementFromPoint(event.clientX, event.clientY)?.closest('[data-direction]');
        const next =
          hit && pad.contains(hit)
            ? directions.find((item) => item.name === hit.getAttribute('data-direction'))
            : undefined;
        if (active.get(event.pointerId) === next) return;
        active.set(event.pointerId, next);
        update();
      });
      const release = (event: PointerEvent) => {
        if (!active.delete(event.pointerId) || !this.shown(pad)) return;
        update();
        this.stopKeepaliveIfIdle();
      };
      button.addEventListener('pointerup', release);
      button.addEventListener('pointercancel', release);
      pad.append(button);
    }
    return pad;
  }

  private createButton(
    action: string,
    index: number,
    base: number,
    columns: number,
    declaration?: NonNullable<GameManifest['inputs']['controls']>[string]['buttons'][number],
  ): HTMLButtonElement {
    const button = this.hostDocument.createElement('button');
    button.type = 'button';
    button.dataset.action = action;
    button.setAttribute('aria-label', declaration?.label ?? actionLabel(action));
    if (declaration) {
      button.dataset.behavior = declaration.behavior;
      button.setAttribute('aria-description', declaration.behavior === 'hold' ? 'Hold' : 'Tap');
    }
    const size = index === 0 ? 64 : 44;
    const icon = this.hostDocument.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    const name = declaration?.icon ?? actionIcon(action, this.inputs.icons);
    icon.dataset.icon = name;
    icon.innerHTML = TOUCH_ICON_SVG[name];
    icon.style.display = 'block';
    icon.style.width = `${Math.round(size * 0.5)}px`;
    icon.style.height = `${Math.round(size * 0.5)}px`;
    button.append(icon);
    const inset = (64 - size) / 2;
    button.style.setProperty('--ogm-landscape-right', `${8 + index * 64 + inset}px`);
    button.style.setProperty('--ogm-landscape-bottom', `${8 + inset}px`);
    Object.assign(button.style, {
      position: 'absolute',
      right: `${EDGE + (index % columns) * BUTTON_PITCH + inset}px`,
      bottom: `${base + Math.floor(index / columns) * BUTTON_PITCH + inset}px`,
      transform: 'translate(calc(-1 * env(safe-area-inset-right, 0px)), calc(-1 * env(safe-area-inset-bottom, 0px)))',
      width: `${size}px`,
      height: `${size}px`,
      display: 'grid',
      placeItems: 'center',
      padding: '0',
      color: 'white',
      borderRadius: '50%',
      background: 'rgba(0, 0, 0, 0.35)',
      border: '1px solid rgba(255, 255, 255, 0.6)',
      pointerEvents: 'auto',
      touchAction: 'none',
    });
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (!this.shown(button)) return;
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

  private emit(cancelPending = false): void {
    if (!this.enabled || this.now() < this.suppressedUntil) return;
    this.options.onFrame({
      playerIndex: this.options.playerIndex,
      tick: Math.max(0, Math.floor(this.now())),
      source: 'touch',
      ...(cancelPending ? { cancelPending: true } : {}),
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

  private shown(control: HTMLElement): boolean {
    return this.options.layer.contains(control) && !this.options.layer.hidden && control.style.visibility !== 'hidden';
  }

  private applyLayout(): void {
    for (const control of this.outsideMenu) control.style.visibility = this.layout === 'menu' ? 'hidden' : '';
  }

  private refreshVisibility(): void {
    const hidden =
      !this.enabled ||
      this.loading ||
      this.layout === 'none' ||
      !this.coarsePointer() ||
      this.now() < this.suppressedUntil;
    this.options.layer.hidden = hidden;
    this.options.layer.setAttribute('aria-hidden', String(hidden));
  }

  private startKeepalive(): void {
    if (this.keepaliveTimer) return;
    this.keepaliveTimer = setInterval(() => this.emit(), 250);
  }

  private deactivate(emitReset: boolean): void {
    this.clearDpadPointers?.();
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
    if (emitReset && (active || Object.keys(this.actions).length > 0)) this.emit(true);
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
