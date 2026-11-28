import type { ActionFrame, RigInputMapping } from '@ogm/contracts';
import { describe, expect, it, vi } from 'vitest';

import { InputMerger, type InputBridge } from './merger.js';

const mapping: RigInputMapping = {
  keyboard: {
    KeyW: 'move.up',
    KeyA: 'move.left',
    KeyS: 'move.down',
    KeyD: 'move.right',
    Escape: 'host.pause',
  },
  touch: 'stick',
  gamepad: { leftStick: 'move' },
  pointerLock: false,
};

function setup() {
  let hostListener: ((frame: ActionFrame) => void) | undefined;
  const send = vi.fn();
  const bridge: InputBridge = {
    on: (_type, listener) => {
      hostListener = listener;
      return () => {
        hostListener = undefined;
      };
    },
    send,
  };
  const canvas = document.createElement('canvas');
  const merger = new InputMerger({ localPlayerIndex: 0, mapping, canvas, bridge, maxLocalPlayers: 2 });
  return { bridge, canvas, host: (frame: ActionFrame) => hostListener?.(frame), merger, send };
}

describe('InputMerger', () => {
  it('replaces keyboard bindings and clears keys held under the previous mapping', () => {
    const { canvas, merger } = setup();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    expect(merger.sample(1)[0]!.actions).toEqual({ move: { x: 0, y: 1 } });
    merger.setKeyboardMapping({ KeyJ: 'jump' });
    expect(merger.sample(2)[0]!.actions).toEqual({});
    const key = new KeyboardEvent('keydown', { code: 'KeyJ', cancelable: true });
    canvas.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(true);
    expect(merger.sample(3)[0]!.actions).toEqual({ jump: true });
  });

  it('keeps modifier keys usable as existing bindings while leaving browser shortcuts alone', () => {
    const { canvas, merger } = setup();
    merger.setKeyboardMapping({ ControlLeft: 'crouch', KeyW: 'move.up' });
    canvas.dispatchEvent(new KeyboardEvent('keydown', { code: 'ControlLeft', ctrlKey: true }));
    const shortcut = new KeyboardEvent('keydown', { code: 'KeyW', ctrlKey: true, cancelable: true });
    canvas.dispatchEvent(shortcut);
    expect(shortcut.defaultPrevented).toBe(false);
    expect(merger.sample(1)[0]!.actions).toEqual({ crouch: true });
  });
  it('merges local keyboard with host gamepad and gives gamepad action ties priority', () => {
    const { canvas, host, merger } = setup();
    host({ playerIndex: 0, tick: 0, source: 'gamepad', actions: { jump: true, move: { x: 0.5, y: 0 } } });
    canvas.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    canvas.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }));

    expect(merger.sample(7)).toEqual([
      {
        playerIndex: 0,
        tick: 7,
        source: 'gamepad',
        actions: { jump: true, move: { x: 0.5, y: 0 } },
      },
    ]);
  });

  it('does not let a connected idle gamepad mask active touch controls', () => {
    const { host, merger } = setup();
    host({ playerIndex: 0, tick: 1, source: 'touch', actions: { move: { x: 1, y: 0 }, jump: true } });
    host({ playerIndex: 0, tick: 1, source: 'gamepad', actions: { move: { x: 0, y: 0 }, jump: false } });
    expect(merger.sample(1)[0]).toMatchObject({ source: 'touch', actions: { move: { x: 1, y: 0 }, jump: true } });
    host({ playerIndex: 0, tick: 2, source: 'touch', actions: { move: { x: 0, y: 0 }, jump: false } });
    expect(merger.sample(2)[0]!.actions).toEqual({ move: { x: 0, y: 0 }, jump: false });
  });

  it('keeps host players separate and drops indexes outside the configured local count', () => {
    const { host, merger } = setup();
    host({ playerIndex: 1, tick: 0, source: 'gamepad', actions: { jump: true } });
    host({ playerIndex: 2, tick: 0, source: 'gamepad', actions: { jump: true } });

    expect(merger.sample(2).map(({ playerIndex }) => playerIndex)).toEqual([0, 1]);
    expect(merger.dropped).toBe(1);
  });

  it('delivers injected input on the next tick only', () => {
    const { merger } = setup();
    merger.inject({ playerIndex: 0, tick: 0, source: 'keyboard', actions: { use: true } });

    expect(merger.sample(3)[0]!.actions.use).toBe(true);
    expect(merger.sample(4)[0]!.actions.use).toBeUndefined();
  });

  it('accumulates pointer deltas and keeps pointer sensitivity when gamepad owns another action', () => {
    const { host, merger } = setup();
    host({ playerIndex: 0, tick: 0, source: 'gamepad', actions: { move: { x: 0.5, y: 0 } } });
    merger.inject({ playerIndex: 0, tick: 0, source: 'pointer', actions: { look: { x: 4, y: -2 } } });
    merger.inject({ playerIndex: 0, tick: 0, source: 'pointer', actions: { look: { x: 6, y: 3 } } });

    expect(merger.sample(8)[0]).toMatchObject({
      source: 'pointer',
      actions: { move: { x: 0.5, y: 0 }, look: { x: 10, y: 1 } },
    });
  });

  it('defaults to four local players', () => {
    const merger = new InputMerger({ localPlayerIndex: 0, mapping });
    merger.acceptHostFrame({ playerIndex: 4, tick: 0, source: 'gamepad', actions: { jump: true } });

    expect(merger.dropped).toBe(1);
    expect(merger.sample(1).map(({ playerIndex }) => playerIndex)).toEqual([0]);
  });

  it('moves browser input ownership when the local player changes', () => {
    const { canvas, merger } = setup();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));

    merger.setLocalPlayerIndex(1);

    expect(merger.sample(1)).toEqual([{ playerIndex: 1, tick: 1, source: 'keyboard', actions: {} }]);
  });

  it('does not replay stale directional vectors after other keys change', () => {
    const { canvas, merger } = setup();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }));
    canvas.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyA' }));
    expect(merger.sample(0)[0]!.actions.move).toEqual({ x: -1, y: 0 });
    canvas.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    canvas.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS' }));
    canvas.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
    expect(merger.sample(1)[0]!.actions.move).toEqual({ x: 0, y: -1 });
    merger.setKeyboardMapping({ KeyW: 'move.up', KeyJ: 'jump' });
    canvas.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    merger.sample(2);
    canvas.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ' }));
    canvas.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
    expect(merger.sample(3)[0]!.actions.move).toBeUndefined();
  });

  it('keeps opposing held directions neutral', () => {
    const { canvas, merger } = setup();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }));
    canvas.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyA' }));
    expect(merger.sample(0)[0]!.actions.move).toEqual({ x: -1, y: 0 });
    canvas.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    canvas.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS' }));
    expect(merger.sample(1)[0]!.actions.move).toEqual({ x: 0, y: 0 });
  });

  it('latches a directional key tapped between samples', () => {
    const { canvas, merger } = setup();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    canvas.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
    expect(merger.sample(1)[0]!.actions.move).toEqual({ x: 0, y: 1 });
    expect(merger.sample(2)[0]!.actions.move).toBeUndefined();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    merger.sample(3);
    canvas.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }));
    canvas.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyA' }));
    expect(merger.sample(4)[0]!.actions.move).toEqual({ x: -1, y: 1 });
    expect(merger.sample(5)[0]!.actions.move).toEqual({ x: 0, y: 1 });
  });

  it('keeps a quick host D-pad tap for one sample and drops it on cancellation', () => {
    const { host, merger } = setup();
    const frame: ActionFrame = { playerIndex: 0, tick: 1, source: 'touch', actions: { move: { x: 1, y: 0 } } };
    host(frame);
    host({ ...frame, actions: { move: { x: 0, y: 0 } } });
    expect(merger.sample(1)[0]!.actions.move).toEqual({ x: 1, y: 0 });
    expect(merger.sample(2)[0]!.actions.move).toEqual({ x: 0, y: 0 });
    host(frame);
    host({ ...frame, actions: { move: { x: 0, y: 0 } }, cancelPending: true });
    expect(merger.sample(3)[0]!.actions.move).toEqual({ x: 0, y: 0 });
  });

  it('latches short keyboard and host presses once while preserving held keys', () => {
    const { canvas, host, merger } = setup();
    merger.setKeyboardMapping({ KeyJ: 'jump' });
    canvas.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ' }));
    canvas.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyJ' }));
    host({ playerIndex: 0, tick: 0, source: 'gamepad', actions: { fire: true } });
    host({ playerIndex: 0, tick: 1, source: 'gamepad', actions: { fire: false } });
    expect(merger.sample(1)[0]!.actions).toEqual({ jump: true, fire: true });
    expect(merger.sample(2)[0]!.actions).toEqual({ fire: false });
    canvas.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ' }));
    expect(merger.sample(3)[0]!.actions.jump).toBe(true);
    expect(merger.sample(4)[0]!.actions.jump).toBe(true);
    canvas.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyJ' }));
    expect(merger.sample(5)[0]!.actions.jump).toBeUndefined();
  });

  it('forwards Escape as a raw key without producing an action', () => {
    const { canvas, merger, send } = setup();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));

    expect(send).toHaveBeenCalledWith('input.rawKey', { code: 'Escape', down: true });
    expect(merger.sample(1)[0]!.actions).toEqual({});
  });
});
