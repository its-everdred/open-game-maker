import { describe, expect, it, vi } from 'vitest';

import { GamepadPoller } from './gamepad.js';

function pad(index: number, buttons: number[], axes = [0, 0, 0, 0]): Gamepad {
  return {
    id: `pad-${index}`,
    index,
    connected: true,
    mapping: 'standard',
    timestamp: 0,
    axes,
    buttons: Array.from({ length: 16 }, (_, button) => ({
      pressed: (buttons[button] ?? 0) > 0,
      touched: (buttons[button] ?? 0) > 0,
      value: buttons[button] ?? 0,
    })),
    vibrationActuator: null,
  } as unknown as Gamepad;
}

describe('GamepadPoller', () => {
  it('claims pads in order and maps declared actions', () => {
    let pads: (Gamepad | null)[] = [pad(3, [1])];
    const frames = vi.fn();
    const poller = new GamepadPoller({ getGamepads: () => pads, now: () => 10 });
    poller.setMapping({ move: 'leftStick', jump: 'a' }, { move: 'stick', jump: 'button' });
    poller.onFrame(frames);

    poller.poll();
    expect(frames).toHaveBeenLastCalledWith(
      expect.objectContaining({ playerIndex: 0, source: 'gamepad', actions: { move: { x: 0, y: 0 }, jump: true } }),
    );

    pads = [pad(3, [1]), pad(7, [0, 1])];
    poller.poll(20);
    expect(frames).toHaveBeenLastCalledWith(expect.objectContaining({ playerIndex: 1 }));
  });

  it('applies a dead zone and emits unchanged state only as a keepalive', () => {
    let now = 0;
    let current = pad(0, [1], [0.1, 0.1, 0, 0]);
    const frames = vi.fn();
    const poller = new GamepadPoller({ getGamepads: () => [current], now: () => now });
    poller.setMapping({ move: 'leftStick', jump: 'a' }, { move: 'stick', jump: 'button' });
    poller.onFrame(frames);

    poller.poll();
    expect(frames).toHaveBeenLastCalledWith(expect.objectContaining({ actions: { move: { x: 0, y: 0 }, jump: true } }));
    frames.mockClear();
    current = pad(0, [1], [0.5, 0, 0, 0]);
    now = 20;
    poller.poll();
    expect(frames).toHaveBeenCalledTimes(1);
    frames.mockClear();
    now = 200;
    poller.poll();
    expect(frames).not.toHaveBeenCalled();
    now = 300;
    poller.poll();
    expect(frames).toHaveBeenCalledTimes(1);
  });

  it('releases the old action when a control set changes', () => {
    const frames = vi.fn();
    let current = pad(0, [1]);
    const poller = new GamepadPoller({ getGamepads: () => [current], now: () => 10 });
    poller.setMapping(undefined, { attack: 'button' });
    poller.onFrame(frames);
    poller.poll();
    poller.setMapping(undefined, { talk: 'button' });
    expect(frames).toHaveBeenLastCalledWith(expect.objectContaining({ actions: { attack: false } }));
    poller.poll();
    expect(frames).toHaveBeenLastCalledWith(expect.objectContaining({ actions: { talk: false } }));
    current = pad(0, [0]);
    poller.poll(20);
    current = pad(0, [1]);
    poller.poll(30);
    expect(frames).toHaveBeenLastCalledWith(expect.objectContaining({ actions: { talk: true } }));
  });

  it('cancels held input when a different control set has identical mappings', () => {
    const frames = vi.fn();
    let current = pad(0, [1]);
    const poller = new GamepadPoller({ getGamepads: () => [current], now: () => 10 });
    poller.setMapping(undefined, { confirm: 'button' });
    poller.onFrame(frames);
    poller.poll();
    poller.setMapping(undefined, { confirm: 'button' }, true);
    expect(frames).toHaveBeenLastCalledWith(
      expect.objectContaining({ cancelPending: true, actions: { confirm: false } }),
    );
    poller.poll();
    expect(frames).toHaveBeenLastCalledWith(expect.objectContaining({ actions: { confirm: false } }));
    current = pad(0, [0]);
    poller.poll(20);
    current = pad(0, [1]);
    poller.poll(30);
    expect(frames).toHaveBeenLastCalledWith(expect.objectContaining({ actions: { confirm: true } }));
  });

  it('uses B for a named menu back binding and does not treat X as back', () => {
    let current = pad(0, [0, 1, 0]);
    const frames = vi.fn();
    const poller = new GamepadPoller({ getGamepads: () => [current], now: () => 10 });
    poller.setMapping({ confirm: 'a', back: 'b' }, { confirm: 'button', back: 'button' });
    poller.onFrame(frames);
    poller.poll();
    expect(frames).toHaveBeenLastCalledWith(expect.objectContaining({ actions: { confirm: false, back: true } }));
    current = pad(0, [0, 0, 1]);
    poller.poll(20);
    expect(frames).toHaveBeenLastCalledWith(expect.objectContaining({ actions: { confirm: false, back: false } }));
  });

  it('exposes snapshots instead of frames in edit mode', () => {
    const frames = vi.fn();
    const snapshots = vi.fn();
    const poller = new GamepadPoller({ getGamepads: () => [pad(0, [1])], now: () => 1 });
    poller.setMapping({ jump: 'a' }, { jump: 'button' });
    poller.setMode('edit');
    poller.onFrame(frames);
    poller.onPadSnapshot(snapshots);
    poller.poll();
    expect(frames).not.toHaveBeenCalled();
    expect(snapshots).toHaveBeenCalledWith(expect.objectContaining({ playerIndex: 0 }));
  });

  it('releases a player claim when its controller disconnects', () => {
    let pads: Gamepad[] = [pad(3, [1])];
    const frames = vi.fn();
    const poller = new GamepadPoller({ getGamepads: () => pads, now: () => 1 });
    poller.setMapping({ jump: 'a' }, { jump: 'button' });
    poller.onFrame(frames);
    poller.poll();
    expect(frames).toHaveBeenLastCalledWith(expect.objectContaining({ playerIndex: 0 }));

    pads = [];
    poller.poll(2);
    expect(frames).toHaveBeenLastCalledWith(expect.objectContaining({ playerIndex: 0, actions: { jump: false } }));
    pads = [pad(7, [1])];
    poller.poll(3);

    expect(frames).toHaveBeenLastCalledWith(expect.objectContaining({ playerIndex: 0 }));
  });
});
