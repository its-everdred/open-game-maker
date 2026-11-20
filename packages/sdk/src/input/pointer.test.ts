import type { RigInputMapping } from '@ogm/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InputMerger } from './merger.js';

const mapping: RigInputMapping = {
  keyboard: {},
  touch: 'two-stick',
  gamepad: {},
  pointerLock: true,
};

afterEach(() => {
  Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: null });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('pointer input', () => {
  it('binds mouse buttons, latches taps, and ignores touch', () => {
    const canvas = document.createElement('canvas');
    const merger = new InputMerger({
      localPlayerIndex: 0,
      mapping: { ...mapping, pointer: { buttons: { '0': 'attack', '2': 'dodge' } } },
      canvas,
    });
    canvas.dispatchEvent(new MouseEvent('pointerdown', { button: 0 }));
    expect(merger.sample(1)[0]!.actions.attack).toBe(true);
    canvas.dispatchEvent(new MouseEvent('pointerup', { button: 0 }));
    expect(merger.sample(2)[0]!.actions.attack).toBeUndefined();
    canvas.dispatchEvent(new MouseEvent('pointerdown', { button: 2 }));
    canvas.dispatchEvent(new MouseEvent('pointerup', { button: 2 }));
    expect(merger.sample(3)[0]!.actions.dodge).toBe(true);
    expect(merger.sample(4)[0]!.actions.dodge).toBeUndefined();
    const entering = new MouseEvent('pointermove', { buttons: 1 });
    Object.defineProperty(entering, 'pointerType', { value: 'mouse' });
    canvas.dispatchEvent(entering);
    expect(merger.sample(5)[0]!.actions.attack).toBeUndefined();
    canvas.dispatchEvent(new MouseEvent('pointerdown', { button: 0 }));
    const chord = new MouseEvent('pointermove', { buttons: 3 });
    Object.defineProperty(chord, 'pointerType', { value: 'mouse' });
    canvas.dispatchEvent(chord);
    expect(merger.sample(5)[0]!.actions).toMatchObject({ attack: true, dodge: true });
    const release = new MouseEvent('pointermove', { buttons: 1 });
    Object.defineProperty(release, 'pointerType', { value: 'mouse' });
    canvas.dispatchEvent(release);
    expect(merger.sample(6)[0]!.actions.dodge).toBeUndefined();
    canvas.dispatchEvent(new Event('lostpointercapture'));
    canvas.dispatchEvent(entering);
    expect(merger.sample(7)[0]!.actions.attack).toBeUndefined();
    const menu = new MouseEvent('contextmenu', { cancelable: true });
    canvas.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
    const touch = new MouseEvent('pointerdown', { button: 0 });
    Object.defineProperty(touch, 'pointerType', { value: 'touch' });
    canvas.dispatchEvent(touch);
    expect(merger.sample(8)[0]!.actions.attack).toBeUndefined();
    merger.dispose();
  });

  it('retains a held button when pointer lock releases capture', () => {
    const canvas = document.createElement('canvas');
    const merger = new InputMerger({
      localPlayerIndex: 0,
      mapping: { ...mapping, pointer: { buttons: { '0': 'attack' } } },
      canvas,
    });
    canvas.dispatchEvent(new MouseEvent('pointerdown', { button: 0 }));
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: canvas });
    canvas.dispatchEvent(new Event('lostpointercapture'));
    expect(merger.sample(1)[0]!.actions.attack).toBe(true);
    expect(merger.sample(2)[0]!.actions.attack).toBe(true);
    merger.dispose();
  });

  it('does not transfer a held pointer to a new local player', () => {
    const canvas = document.createElement('canvas');
    const merger = new InputMerger({
      localPlayerIndex: 0,
      mapping: { ...mapping, pointer: { buttons: { '0': 'attack' } } },
      canvas,
    });
    canvas.dispatchEvent(new MouseEvent('pointerdown', { button: 0 }));
    expect(merger.sample(1)[0]!.actions.attack).toBe(true);
    merger.setLocalPlayerIndex(1);
    const move = new MouseEvent('pointermove', { buttons: 1 });
    Object.defineProperty(move, 'pointerType', { value: 'mouse' });
    canvas.dispatchEvent(move);
    expect(merger.sample(2)[0]!.actions.attack).toBeUndefined();
    merger.dispose();
  });

  it('requests pointer lock only from pointerdown on fine pointers', () => {
    const canvas = document.createElement('canvas');
    const requestPointerLock = vi.fn();
    Object.defineProperty(canvas, 'requestPointerLock', { configurable: true, value: requestPointerLock });
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    );
    const merger = new InputMerger({ localPlayerIndex: 0, mapping, canvas });

    canvas.dispatchEvent(new MouseEvent('mousemove'));
    expect(requestPointerLock).not.toHaveBeenCalled();
    canvas.dispatchEvent(new MouseEvent('pointerdown', { button: 0 }));
    expect(requestPointerLock).toHaveBeenCalledOnce();
    merger.dispose();
  });

  it('never requests pointer lock on coarse pointers', () => {
    const canvas = document.createElement('canvas');
    const requestPointerLock = vi.fn();
    Object.defineProperty(canvas, 'requestPointerLock', { configurable: true, value: requestPointerLock });
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    );
    const merger = new InputMerger({ localPlayerIndex: 0, mapping, canvas });

    canvas.dispatchEvent(new MouseEvent('pointerdown', { button: 0 }));

    expect(requestPointerLock).not.toHaveBeenCalled();
    merger.dispose();
  });

  it('falls back when pointer lock throws synchronously', () => {
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'requestPointerLock', {
      configurable: true,
      value: vi.fn(() => {
        throw new DOMException('denied');
      }),
    });
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const merger = new InputMerger({ localPlayerIndex: 0, mapping, canvas });

    expect(() => canvas.dispatchEvent(new MouseEvent('pointerdown', { button: 0 }))).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
    merger.dispose();
  });

  it('captures drag pointers and releases an owned pointer lock when disabled', () => {
    const canvas = document.createElement('canvas');
    const capture = vi.fn();
    const release = vi.fn();
    Object.defineProperties(canvas, {
      setPointerCapture: { configurable: true, value: capture },
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: release },
    });
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: canvas });
    const exitPointerLock = vi.fn();
    Object.defineProperty(document, 'exitPointerLock', { configurable: true, value: exitPointerLock });
    const merger = new InputMerger({ localPlayerIndex: 0, mapping, canvas });
    const down = new MouseEvent('pointerdown', { button: 2 });
    Object.defineProperty(down, 'pointerId', { value: 7 });
    const up = new MouseEvent('pointerup');
    Object.defineProperty(up, 'pointerId', { value: 7 });

    canvas.dispatchEvent(down);
    canvas.dispatchEvent(up);
    merger.setPointerLock(false);

    expect(capture).toHaveBeenCalledWith(7);
    expect(release).toHaveBeenCalledWith(7);
    expect(exitPointerLock).toHaveBeenCalledOnce();
    merger.dispose();
  });
});
