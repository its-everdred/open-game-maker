import type { ActionFrame } from '@ogm/contracts/input';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deliverMenuFrame, setMenuActionKinds, setMenuControlInputs } from './host-frames.js';
import { createMenu, type Menu } from './index.js';
import { SdkHostApi } from '../core/host-api.js';

// Dusk Helm's shape: one stick, then buttons in the order the host draws them (first = A) and binds pads (a, x, b).
const kinds = { move: 'stick', attack: 'button', block: 'button', charge: 'button' } as const;

function title() {
  document.body.innerHTML = `
    <div id="menu">
      <button id="settings">Settings</button>
      <button id="play" data-gm-primary>Play</button>
      <button id="quit">Quit</button>
    </div>`;
  const clicks: string[] = [];
  for (const button of document.querySelectorAll('button'))
    button.addEventListener('click', () => clicks.push(button.id));
  return { root: document.querySelector<HTMLElement>('#menu')!, clicks };
}

const frame = (source: ActionFrame['source'], actions: ActionFrame['actions'], playerIndex = 0): ActionFrame => ({
  playerIndex,
  tick: 0,
  source,
  actions,
});

const key = (code: string, type: 'keydown' | 'keyup' = 'keydown') => {
  const event = new KeyboardEvent(type, { code, bubbles: true, cancelable: true });
  document.body.dispatchEvent(event);
  return event;
};

describe('createMenu', () => {
  let menus: Menu[] = [];
  const open = (...args: Parameters<typeof createMenu>) => {
    const menu = createMenu(...args);
    menus.push(menu);
    return menu;
  };

  beforeEach(() => {
    setMenuActionKinds(kinds);
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  });

  afterEach(() => {
    for (const menu of menus) menu.dispose();
    menus = [];
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('focuses the primary action and marks it for the game to highlight', () => {
    const { root } = title();
    const menu = open({ root });
    expect(menu.focused?.id).toBe('play');
    expect(document.querySelector('[data-gm-focus]')?.id).toBe('play');
  });

  it('uses the active named set for touch confirm and back', () => {
    setMenuControlInputs({
      actions: {
        move: 'stick',
        attack: 'button',
        block: 'button',
        charge: 'button',
        accept: 'button',
        cancel: 'button',
      },
      controls: {
        menu: {
          layout: 'dpad',
          stick: 'move',
          buttons: [
            { action: 'accept', icon: 'confirm', label: 'Confirm', behavior: 'tap' },
            { action: 'cancel', icon: 'back', label: 'Back', behavior: 'tap' },
          ],
        },
      },
    });
    const host = new SdkHostApi(
      () => undefined,
      () => undefined,
    );
    host.controls.set({ layout: 'menu' });
    const { root, clicks } = title();
    const onBack = vi.fn();
    open({ root, onBack });
    deliverMenuFrame(frame('touch', { accept: true }));
    deliverMenuFrame(frame('touch', { accept: false, cancel: true }));
    expect(clicks).toEqual(['play']);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('starts the game from the title when Enter or Space is pressed, once per press', () => {
    const { root, clicks } = title();
    open({ root });
    const enter = key('Enter');
    expect(enter.defaultPrevented).toBe(true);
    key('Space');
    expect(key('Space', 'keyup').defaultPrevented).toBe(true);
    expect(clicks).toEqual(['play', 'play']);
  });

  it('moves focus with the arrow keys', () => {
    const { root, clicks } = title();
    const menu = open({ root });
    key('ArrowDown');
    expect(menu.focused?.id).toBe('quit');
    key('ArrowUp');
    key('ArrowUp');
    expect(menu.focused?.id).toBe('settings');
    expect(document.querySelectorAll('[data-gm-focus]')).toHaveLength(1);
    key('Enter');
    expect(clicks).toEqual(['settings']);
  });

  it("presses the focused item from the on-screen controller's A button, once while it is held", () => {
    const { root, clicks } = title();
    open({ root });
    deliverMenuFrame(frame('touch', { attack: true }));
    deliverMenuFrame(frame('touch', { attack: true }));
    deliverMenuFrame(frame('touch', { attack: false }));
    expect(clicks).toEqual(['play']);
  });

  it('moves with the on-screen stick, one step per push', () => {
    const { root } = title();
    const menu = open({ root });
    deliverMenuFrame(frame('touch', { move: { x: 0, y: 0.9 } }));
    deliverMenuFrame(frame('touch', { move: { x: 0.1, y: 1 } }));
    expect(menu.focused?.id).toBe('quit');
    deliverMenuFrame(frame('touch', { move: { x: 0, y: 0 } }));
    deliverMenuFrame(frame('touch', { move: { x: 0, y: -0.8 } }));
    expect(menu.focused?.id).toBe('play');
  });

  it("goes back with B (the host pad's b, the third declared button) and Escape", () => {
    const { root } = title();
    const onBack = vi.fn();
    open({ root, onBack });
    deliverMenuFrame(frame('gamepad', { charge: true }));
    expect(key('Escape').defaultPrevented).toBe(true);
    expect(onBack).toHaveBeenCalledTimes(2);
  });

  it('leaves Escape to the host when the menu has no way back', () => {
    const { root } = title();
    open({ root });
    expect(key('Escape').defaultPrevented).toBe(false);
  });

  it("reads a connected gamepad directly while the game has focus, ignoring the host's copy", () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    vi.mocked(document.hasFocus).mockReturnValue(true);
    const buttons = Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 }));
    const pad = { index: 0, connected: true, buttons, axes: [0, 0, 0, 0] } as unknown as Gamepad;
    const { root, clicks } = title();
    const menu = open({ root, getGamepads: () => [pad] });

    deliverMenuFrame(frame('gamepad', { attack: true }));
    expect(clicks).toEqual([]);

    buttons[13]!.pressed = true;
    vi.advanceTimersByTime(20);
    expect(menu.focused?.id).toBe('quit');
    buttons[13]!.pressed = false;
    buttons[12]!.pressed = true;
    vi.advanceTimersByTime(20);
    buttons[12]!.pressed = false;
    buttons[0]!.pressed = true;
    vi.advanceTimersByTime(20);
    vi.advanceTimersByTime(20);
    expect(clicks).toEqual(['play']);
  });

  it('gives input to the newest menu and hands it back when that menu closes', () => {
    const { root, clicks } = title();
    open({ root });
    const dialog = document.createElement('div');
    dialog.innerHTML = '<button id="ok">OK</button>';
    document.body.append(dialog);
    dialog.querySelector('button')!.addEventListener('click', () => clicks.push('ok'));
    const top = open({ root: dialog });
    expect(document.querySelectorAll('[data-gm-focus]')).toHaveLength(1);
    key('Enter');
    top.dispose();
    expect(document.querySelector('[data-gm-focus]')?.id).toBe('play');
    key('Enter');
    expect(clicks).toEqual(['ok', 'play']);
  });

  it('refocuses when the game hides the focused item', () => {
    const { root } = title();
    const menu = open({ root });
    key('ArrowDown');
    document.querySelector<HTMLElement>('#quit')!.hidden = true;
    key('ArrowUp');
    expect(menu.focused?.id).toBe('settings');
  });

  it('needs a fresh A press for the next menu after A closed the last one', () => {
    const { root, clicks } = title();
    const first = open({ root });
    root.querySelector('#play')!.addEventListener('click', () => first.dispose());
    deliverMenuFrame(frame('touch', { attack: true }));
    deliverMenuFrame(frame('touch', { attack: false }));
    open({ root });
    deliverMenuFrame(frame('touch', { attack: true }));
    expect(clicks).toEqual(['play', 'play']);
  });

  it('ignores an A still held from play when a menu opens, until it is pressed again', () => {
    // Player 3's controller, untouched by the other tests.
    deliverMenuFrame(frame('touch', { attack: true }, 3));
    const { root, clicks } = title();
    open({ root });
    deliverMenuFrame(frame('touch', { attack: true }, 3));
    expect(clicks).toEqual([]);
    deliverMenuFrame(frame('touch', { attack: false }, 3));
    deliverMenuFrame(frame('touch', { attack: true }, 3));
    expect(clicks).toEqual(['play']);
  });

  it('acts once per controller sample, so a press that opens a submenu does not also take it back', () => {
    const { root, clicks } = title();
    const onBack = vi.fn();
    root.querySelector('#play')!.addEventListener('click', () => {
      const dialog = document.createElement('div');
      dialog.innerHTML = '<button>OK</button>';
      document.body.append(dialog);
      open({ root: dialog, onBack });
    });
    const titleBack = vi.fn();
    open({ root, onBack: titleBack });
    deliverMenuFrame(frame('gamepad', { attack: true, charge: true }, 2));
    expect(clicks).toEqual(['play']);
    expect(onBack).not.toHaveBeenCalled();
    expect(titleBack).not.toHaveBeenCalled();
  });

  it('stops reading pads when a pad press closes the last menu', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    vi.mocked(document.hasFocus).mockReturnValue(true);
    const buttons = Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 }));
    const pad = { index: 1, connected: true, buttons, axes: [0, 0, 0, 0] } as unknown as Gamepad;
    const { root, clicks } = title();
    const menu = open({ root, getGamepads: () => [pad] });
    root.querySelector('#play')!.addEventListener('click', () => menu.dispose());
    buttons[0]!.pressed = true;
    vi.advanceTimersByTime(20);
    expect(clicks).toEqual(['play']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves keys in a text field to the field, and ignores a held Enter', () => {
    document.body.innerHTML = '<div id="menu"><input id="name"><button id="ok">OK</button></div>';
    const root = document.querySelector<HTMLElement>('#menu')!;
    const clicks: string[] = [];
    root.querySelector('#ok')!.addEventListener('click', () => clicks.push('ok'));
    const menu = open({ root, initial: root.querySelector<HTMLElement>('#ok') });
    const input = root.querySelector<HTMLInputElement>('#name')!;
    const arrow = new KeyboardEvent('keydown', { code: 'ArrowRight', bubbles: true, cancelable: true });
    input.dispatchEvent(arrow);
    expect(arrow.defaultPrevented).toBe(false);
    expect(menu.focused?.id).toBe('ok');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', repeat: true, bubbles: true }));
    expect(clicks).toEqual([]);
  });

  it('stops listening once every menu is closed', () => {
    const { root, clicks } = title();
    open({ root }).dispose();
    key('Enter');
    deliverMenuFrame(frame('touch', { attack: true }));
    expect(clicks).toEqual([]);
  });
});
