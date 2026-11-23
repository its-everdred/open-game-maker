import type { ActionFrame, ActionValue } from '@ogm/contracts/input';

import { onMenuFrame, type ActionKinds } from './host-frames.js';

export type MenuDirection = 'up' | 'down' | 'left' | 'right';

export interface MenuOptions {
  /** The menu's container; its visible buttons, links, fields and `[data-gm-menu-item]` elements are navigable. */
  root: HTMLElement;
  /** Focused first. Defaults to `[data-gm-primary]` inside the root, else the first item. */
  initial?: HTMLElement | null;
  /** B, Escape: leave this menu. Without it, back does nothing. */
  onBack?: () => void;
  getGamepads?: () => readonly (Gamepad | null)[];
}

export interface Menu {
  readonly focused: HTMLElement | undefined;
  focus(element: HTMLElement): void;
  dispose(): void;
}

const ITEMS =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [data-gm-menu-item]';
const FOCUS_ATTR = 'data-gm-focus';
const STICK_THRESHOLD = 0.5;
// The host's default pad layout gives declared buttons a, x, b, ... in order; the overlay draws them in that order too.
const CONFIRM_BUTTON = 0;
const BACK_BUTTON = 2;
const PAD = { a: 0, b: 1, up: 12, down: 13, left: 14, right: 15 } as const;

type Edge = { confirm: boolean; back: boolean; direction: MenuDirection | null };

class MenuImpl implements Menu {
  current: HTMLElement | undefined;

  constructor(readonly options: MenuOptions) {}

  get focused(): HTMLElement | undefined {
    return this.current;
  }

  focus(element: HTMLElement): void {
    if (this.current !== element) this.current?.removeAttribute(FOCUS_ATTR);
    this.current = element;
    if (stack.at(-1) !== this) return;
    element.setAttribute(FOCUS_ATTR, '');
    // A cross-origin game frame that does not have focus must not pull it away from the host page.
    if (element.ownerDocument.hasFocus()) element.focus({ preventScroll: true });
  }

  items(): HTMLElement[] {
    return [...this.options.root.querySelectorAll<HTMLElement>(ITEMS)].filter(
      (element) => !element.closest('[hidden], [inert]') && (element.checkVisibility?.() ?? true),
    );
  }

  /** The focused item, re-picked when the game removed or hid it. */
  active(): HTMLElement | undefined {
    const items = this.items();
    if (this.current && items.includes(this.current)) return this.current;
    const primary = this.options.root.querySelector<HTMLElement>('[data-gm-primary]');
    const initial = [this.options.initial, primary].find((element) => element && items.includes(element));
    const next = initial ?? items[0];
    if (next) this.focus(next);
    return next;
  }

  move(direction: MenuDirection): void {
    const from = this.active();
    if (!from) return;
    const next = nearest(from, this.items(), direction);
    if (next) this.focus(next);
  }

  confirm(): void {
    this.active()?.click();
  }

  back(): void {
    this.options.onBack?.();
  }

  show(): void {
    if (this.current) this.focus(this.current);
    else this.active();
  }

  hide(): void {
    this.current?.removeAttribute(FOCUS_ATTR);
  }

  dispose(): void {
    const index = stack.indexOf(this);
    if (index < 0) return;
    this.hide();
    stack.splice(index, 1);
    if (index === stack.length) stack.at(-1)?.show();
    if (stack.length === 0) uninstall();
  }
}

function center(element: HTMLElement): { x: number; y: number; empty: boolean } {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, empty: rect.width === 0 && rect.height === 0 };
}

/** The closest item in that direction; DOM order when the items have no layout (a headless document). */
function nearest(from: HTMLElement, items: HTMLElement[], direction: MenuDirection): HTMLElement | undefined {
  const origin = center(from);
  const others = items.filter((item) => item !== from);
  if (origin.empty && others.every((item) => center(item).empty)) {
    const index = items.indexOf(from);
    return items[direction === 'down' || direction === 'right' ? index + 1 : index - 1];
  }
  let best: HTMLElement | undefined;
  let bestScore = Infinity;
  for (const item of others) {
    const point = center(item);
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    const along = direction === 'left' ? -dx : direction === 'right' ? dx : direction === 'up' ? -dy : dy;
    const across = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
    if (along <= 0) continue;
    const score = along + across * 2;
    if (score < bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return best;
}

function directionOf(x: number, y: number): MenuDirection | null {
  if (Math.max(Math.abs(x), Math.abs(y)) < STICK_THRESHOLD) return null;
  // Host sticks and pads report y growing downward.
  if (Math.abs(x) > Math.abs(y)) return x > 0 ? 'right' : 'left';
  return y > 0 ? 'down' : 'up';
}

const stack: MenuImpl[] = [];
const edges = new Map<string, Edge>();
let cleanup: (() => void) | undefined;
let defaultStyle: HTMLStyleElement | undefined;

/**
 * Record one sampled state from a controller and act on what changed since its last sample. Held state is recorded
 * with no menu open too, so a button still held from gameplay or from the press that closed the last menu does not
 * press the next one.
 */
function apply(key: string, next: Edge, act = true): void {
  const previous = edges.get(key) ?? { confirm: false, back: false, direction: null };
  edges.set(key, next);
  const menu = stack.at(-1);
  if (!menu || !act) return;
  // One action per sample: a press may close this menu or open another, which must not take the rest.
  if (next.confirm && !previous.confirm) menu.confirm();
  else if (next.back && !previous.back) menu.back();
  else if (next.direction && next.direction !== previous.direction) menu.move(next.direction);
}

function pressed(value: ActionValue | undefined): boolean {
  return value === true || (typeof value === 'number' && value > STICK_THRESHOLD);
}

function onHostFrame(frame: ActionFrame, kinds: ActionKinds, act: boolean): void {
  if (frame.source !== 'touch' && frame.source !== 'gamepad') return;
  // A focused frame reads its pads directly; the host's copy of the same press would land twice.
  if (frame.source === 'gamepad' && document.hasFocus()) act = false;
  const buttons = Object.keys(kinds).filter((action) => kinds[action] === 'button');
  const stick = Object.keys(kinds).find((action) => kinds[action] === 'stick');
  const vector = stick ? frame.actions[stick] : undefined;
  apply(
    `${frame.source}:${frame.playerIndex}`,
    {
      confirm: pressed(frame.actions[buttons[CONFIRM_BUTTON] ?? '']),
      back: pressed(frame.actions[buttons[BACK_BUTTON] ?? '']),
      direction: typeof vector === 'object' ? directionOf(vector.x, vector.y) : null,
    },
    act,
  );
}

onMenuFrame(onHostFrame);

let padsFocused = false;

function pollPads(act: boolean): void {
  const getGamepads = stack.at(-1)?.options.getGamepads ?? (() => navigator.getGamepads?.() ?? []);
  const focused = document.hasFocus();
  // Pads are unreadable without focus; the first read after gaining it only notes what is already held.
  if (!padsFocused) act = false;
  padsFocused = focused;
  if (!focused) return;
  for (const pad of getGamepads()) {
    if (!pad?.connected) continue;
    const button = (index: number) => pad.buttons[index]?.pressed ?? false;
    const dpadX = Number(button(PAD.right)) - Number(button(PAD.left));
    const dpadY = Number(button(PAD.down)) - Number(button(PAD.up));
    apply(
      `pad:${pad.index}`,
      {
        confirm: button(PAD.a),
        back: button(PAD.b),
        direction: directionOf(dpadX || (pad.axes[0] ?? 0), dpadY || (pad.axes[1] ?? 0)),
      },
      act,
    );
  }
}

const KEY_DIRECTIONS: Record<string, MenuDirection> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

function typing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  );
}

function onKeyDown(event: KeyboardEvent): void {
  const menu = stack.at(-1);
  if (!menu) return;
  if (event.code === 'Escape') {
    if (!menu.options.onBack) return;
    event.preventDefault();
    if (!event.repeat) menu.back();
    return;
  }
  if (typing(event.target)) return;
  const direction = KEY_DIRECTIONS[event.code];
  if (direction) {
    event.preventDefault();
    menu.move(direction);
  } else if (event.code === 'Enter' || event.code === 'NumpadEnter' || event.code === 'Space') {
    // Stops the browser's own click on the focused button, which would activate it a second time.
    event.preventDefault();
    if (!event.repeat) menu.confirm();
  }
}

function onKeyUp(event: KeyboardEvent): void {
  if (stack.length && event.code === 'Space' && !typing(event.target)) event.preventDefault();
}

function install(): void {
  if (!defaultStyle) {
    defaultStyle = document.createElement('style');
    defaultStyle.dataset.gmMenu = '';
    // Zero specificity: any `[data-gm-focus]` rule in the game's own UI kit replaces it.
    defaultStyle.textContent = `:where([${FOCUS_ATTR}]){outline:3px solid currentColor;outline-offset:3px}`;
    document.head.append(defaultStyle);
  }
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  // Pads are only read while a menu is open: take their held state first, so a held A does not press this menu.
  padsFocused = false;
  pollPads(false);
  let running = true;
  const loop = () => {
    if (!running) return;
    // Scheduled before polling: a press can close the last menu, and this loop, from inside pollPads.
    handle = requestAnimationFrame(loop);
    pollPads(true);
  };
  let handle = requestAnimationFrame(loop);
  cleanup = () => {
    running = false;
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
    cancelAnimationFrame(handle);
  };
}

function uninstall(): void {
  cleanup?.();
  cleanup = undefined;
}

/**
 * Make a DOM menu playable with the on-screen controller, a keyboard and any connected gamepad, as well as touch.
 * Menus stack: the newest one gets the input until it is disposed.
 */
export function createMenu(options: MenuOptions): Menu {
  const menu = new MenuImpl(options);
  stack.at(-1)?.hide();
  stack.push(menu);
  if (!cleanup) install();
  menu.active();
  return menu;
}
