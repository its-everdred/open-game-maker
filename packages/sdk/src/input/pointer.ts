import type { ActionValue } from '@ogm/contracts';

export interface PointerInputOptions {
  canvas: HTMLCanvasElement;
  pointerLock: boolean;
  buttons?: Record<string, string>;
  setHeld?(actions: Record<string, ActionValue>): void;
  emit(actions: Record<string, ActionValue>): void;
  aim?: (clientX: number, clientY: number) => ActionValue | null;
}

export class PointerInput {
  private dragging = false;
  private suppressHeldButtons = false;
  private readonly pressed = new Set<number>();
  private enabled: boolean;
  private last = { x: 0, y: 0 };
  private pointerLockErrorLogged = false;

  constructor(private readonly options: PointerInputOptions) {
    this.enabled = options.pointerLock;
    options.canvas.addEventListener('contextmenu', this.onContextMenu);
    options.canvas.addEventListener('blur', this.onBlur);
    options.canvas.addEventListener('lostpointercapture', this.onLostPointerCapture);
    options.canvas.addEventListener('pointerdown', this.onPointerDown);
    options.canvas.addEventListener('pointermove', this.onPointerMove);
    options.canvas.addEventListener('pointerup', this.onPointerUp);
    options.canvas.addEventListener('pointercancel', this.onPointerUp);
    document.addEventListener('pointerlockerror', this.onPointerLockError);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
  }

  reset(): void {
    this.suppressHeldButtons = true;
    this.onBlur();
  }

  setPointerLock(enabled: boolean): void {
    this.enabled = enabled && this.options.pointerLock;
    if (!this.enabled) this.exitOwnedPointerLock();
  }

  dispose(): void {
    const canvas = this.options.canvas;
    canvas.removeEventListener('contextmenu', this.onContextMenu);
    canvas.removeEventListener('blur', this.onBlur);
    canvas.removeEventListener('lostpointercapture', this.onLostPointerCapture);
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerUp);
    document.removeEventListener('pointerlockerror', this.onPointerLockError);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.enabled = false;
    this.exitOwnedPointerLock();
  }

  private readonly onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    this.suppressHeldButtons = false;
    this.pressed.add(event.button);
    this.emitHeld();
    this.dragging = true;
    this.options.canvas.setPointerCapture?.(event.pointerId);
    this.last = { x: event.clientX, y: event.clientY };
    if (!this.enabled || event.button !== 0 || globalThis.matchMedia?.('(pointer: coarse)').matches) return;
    try {
      const request = this.options.canvas.requestPointerLock?.();
      if (request && typeof request.catch === 'function') request.catch(() => this.onPointerLockError());
    } catch {
      this.onPointerLockError();
    }
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    // A mouse chord changes buttons via pointermove, not additional down/up events.
    if (event.buttons === 0) this.suppressHeldButtons = false;
    if (
      event.pointerType === 'mouse' &&
      !this.suppressHeldButtons &&
      (this.dragging || document.pointerLockElement === this.options.canvas)
    ) {
      for (const [button, mask] of [1, 4, 2, 8, 16].entries()) {
        if (event.buttons & mask) this.pressed.add(button);
        else this.pressed.delete(button);
      }
      this.emitHeld();
    }
    const locked = document.pointerLockElement === this.options.canvas;
    if (locked || this.dragging) {
      const x = locked ? event.movementX : event.clientX - this.last.x;
      const y = locked ? event.movementY : event.clientY - this.last.y;
      if (x !== 0 || y !== 0) this.options.emit({ look: { x, y } });
    }
    const aim = this.options.aim?.(event.clientX, event.clientY);
    if (aim !== null && aim !== undefined) this.options.emit({ aim });
    this.last = { x: event.clientX, y: event.clientY };
  };

  private readonly onPointerUp = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    if (event.type === 'pointercancel') this.pressed.clear();
    else this.pressed.delete(event.button);
    this.emitHeld();
    this.dragging = false;
    if (this.options.canvas.hasPointerCapture?.(event.pointerId)) {
      this.options.canvas.releasePointerCapture(event.pointerId);
    }
  };

  private readonly onContextMenu = (event: Event) => {
    if (this.options.buttons?.['2']) event.preventDefault();
  };

  private readonly onLostPointerCapture = () => {
    if (document.pointerLockElement !== this.options.canvas) this.onBlur();
  };

  private readonly onBlur = () => {
    this.suppressHeldButtons = true;
    this.dragging = false;
    this.pressed.clear();
    this.emitHeld();
  };

  private emitHeld(): void {
    const actions: Record<string, ActionValue> = {};
    for (const button of this.pressed) {
      const action = this.options.buttons?.[String(button)];
      if (action) actions[action] = true;
    }
    this.options.setHeld?.(actions);
  }

  private readonly onPointerLockChange = () => {
    if (!this.enabled) this.exitOwnedPointerLock();
  };

  private readonly onPointerLockError = () => {
    if (this.pointerLockErrorLogged) return;
    this.pointerLockErrorLogged = true;
    console.warn('pointer lock unavailable; using drag look');
  };

  private exitOwnedPointerLock(): void {
    if (document.pointerLockElement !== this.options.canvas) return;
    try {
      document.exitPointerLock?.();
    } catch {
      // The lock is already being released or the document is leaving; teardown remains best-effort.
    }
  }
}
