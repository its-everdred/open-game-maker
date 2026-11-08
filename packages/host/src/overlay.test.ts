import { afterEach, describe, expect, it, vi } from 'vitest';

import { actionLabel, TouchOverlay } from './overlay.js';

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

function pointer(type: string, values: { pointerId: number; clientX: number; clientY: number }): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, values);
  return event;
}

describe('TouchOverlay', () => {
  it('renders a pass-through stick and accessible button targets', () => {
    const layer = document.createElement('div');
    document.body.append(layer);
    const overlay = new TouchOverlay({
      layer,
      inputs: { actions: { move: 'stick', jump: 'button', use: 'button' } },
      touch: 'stick',
      playerIndex: 0,
      onFrame: vi.fn(),
      coarsePointer: () => true,
    });
    const jump = layer.querySelector<HTMLElement>('[data-action="jump"]')!;
    const use = layer.querySelector<HTMLElement>('[data-action="use"]')!;
    expect(layer.style.pointerEvents).toBe('none');
    expect(layer.querySelector('[data-stick="move"]')).not.toBeNull();
    expect(jump.style.width).toBe('64px');
    expect(use.style.width).toBe('44px');
    overlay.dispose();
  });

  it('emits normalized stick movement and reset frames', () => {
    const layer = document.createElement('div');
    const onFrame = vi.fn();
    const overlay = new TouchOverlay({
      layer,
      inputs: { actions: { move: 'stick' } },
      touch: 'stick',
      playerIndex: 0,
      onFrame,
      coarsePointer: () => true,
      now: () => 10,
    });
    const stick = layer.querySelector<HTMLElement>('[data-stick="move"]')!;
    stick.setPointerCapture = vi.fn();
    stick.dispatchEvent(pointer('pointerdown', { pointerId: 1, clientX: 10, clientY: 10 }));
    stick.dispatchEvent(pointer('pointermove', { pointerId: 1, clientX: 40, clientY: 10 }));
    expect(onFrame).toHaveBeenLastCalledWith(
      expect.objectContaining({ source: 'touch', actions: { move: { x: 0.6, y: 0 } } }),
    );
    stick.dispatchEvent(pointer('pointerup', { pointerId: 1, clientX: 40, clientY: 10 }));
    expect(onFrame).toHaveBeenLastCalledWith(expect.objectContaining({ actions: { move: { x: 0, y: 0 } } }));
    overlay.dispose();
  });

  it('hides for two seconds after keyboard input', () => {
    vi.useFakeTimers();
    const layer = document.createElement('div');
    const overlay = new TouchOverlay({
      layer,
      inputs: { actions: { jump: 'button' } },
      touch: 'stick',
      playerIndex: 0,
      onFrame: vi.fn(),
      coarsePointer: () => true,
      now: () => Date.now(),
    });
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    expect(layer.hidden).toBe(true);
    vi.advanceTimersByTime(2_001);
    expect(layer.hidden).toBe(false);
    overlay.dispose();
  });

  it('neutralizes active touch input while another input source is active', () => {
    vi.useFakeTimers();
    const layer = document.createElement('div');
    const onFrame = vi.fn();
    const overlay = new TouchOverlay({
      layer,
      inputs: { actions: { jump: 'button' } },
      touch: 'stick',
      playerIndex: 0,
      onFrame,
      coarsePointer: () => true,
      now: () => Date.now(),
    });
    const jump = layer.querySelector<HTMLButtonElement>('[data-action="jump"]')!;
    jump.setPointerCapture = vi.fn();
    jump.dispatchEvent(pointer('pointerdown', { pointerId: 1, clientX: 0, clientY: 0 }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    expect(onFrame).toHaveBeenLastCalledWith(expect.objectContaining({ actions: { jump: false } }));
    const callsAfterReset = onFrame.mock.calls.length;

    vi.advanceTimersByTime(251);

    expect(onFrame).toHaveBeenCalledTimes(callsAfterReset);
    overlay.dispose();
  });

  it('continues button input when pointer capture is unavailable', () => {
    const layer = document.createElement('div');
    const onFrame = vi.fn();
    const overlay = new TouchOverlay({
      layer,
      inputs: { actions: { jump: 'button' } },
      touch: 'stick',
      playerIndex: 0,
      onFrame,
      coarsePointer: () => true,
    });
    const jump = layer.querySelector<HTMLButtonElement>('[data-action="jump"]')!;
    jump.setPointerCapture = vi.fn(() => {
      throw new DOMException('not active', 'InvalidStateError');
    });

    jump.dispatchEvent(pointer('pointerdown', { pointerId: 1, clientX: 0, clientY: 0 }));

    expect(onFrame).toHaveBeenLastCalledWith(expect.objectContaining({ actions: { jump: true } }));
    overlay.dispose();
  });

  it('leaves tap-mode games without host controls', () => {
    const layer = document.createElement('div');
    const overlay = new TouchOverlay({
      layer,
      inputs: { actions: { jump: 'button' } },
      touch: 'tap',
      playerIndex: 0,
      onFrame: vi.fn(),
      coarsePointer: () => true,
    });
    expect(layer.childElementCount).toBe(0);
    overlay.dispose();
  });

  // Kevin's iPad (#640): Blobs showed `rotateCCW` and `softDrop` as text on circles piled over each other.
  it('draws an icon on every button and keeps action ids out of the drawn text', () => {
    const layer = document.createElement('div');
    const actions = { move: 'stick', rotateCCW: 'button', soft_drop: 'button', hardDrop: 'button' } as const;
    const overlay = new TouchOverlay({
      layer,
      inputs: { actions },
      touch: 'stick',
      playerIndex: 0,
      onFrame: vi.fn(),
      coarsePointer: () => true,
    });
    const buttons = [...layer.querySelectorAll<HTMLButtonElement>('button')];
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button.textContent).toBe('');
      expect(button.querySelector('[aria-hidden="true"]')).not.toBeNull();
    }
    for (const action of Object.keys(actions)) expect(layer.textContent).not.toContain(action);
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Rotate CCW',
      'Soft drop',
      'Hard drop',
    ]);
    expect(layer.querySelector('[data-stick="move"]')?.getAttribute('aria-label')).toBe('Move');
    overlay.dispose();
  });

  it('turns action ids into words a player would say', () => {
    expect(actionLabel('rotateCCW')).toBe('Rotate CCW');
    expect(actionLabel('softDrop')).toBe('Soft drop');
    expect(actionLabel('jump')).toBe('Jump');
    expect(actionLabel('fire-2')).toBe('Fire 2');
  });

  it.each(['stick', 'two-stick'] as const)('lays out five buttons and the %s controls without overlap', (touch) => {
    const width = 320;
    const height = 480;
    const layer = document.createElement('div');
    const overlay = new TouchOverlay({
      layer,
      inputs: {
        actions: { move: 'stick', look: 'stick', a: 'button', b: 'button', c: 'button', d: 'button', e: 'button' },
      },
      touch,
      playerIndex: 0,
      onFrame: vi.fn(),
      coarsePointer: () => true,
    });
    const rects = [...layer.children].map((element) => rect(element as HTMLElement, width, height));
    expect(rects).toHaveLength(touch === 'two-stick' ? 7 : 6);
    for (const [i, first] of rects.entries()) {
      expect(first.left).toBeGreaterThanOrEqual(0);
      expect(first.top).toBeGreaterThanOrEqual(0);
      for (const second of rects.slice(i + 1)) expect(overlaps(first, second)).toBe(false);
    }
    overlay.dispose();
  });
});

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** jsdom has no layout, so resolve the overlay's absolute insets against a phone-sized layer by hand. */
function rect(element: HTMLElement, width: number, height: number): Rect {
  const px = (value: string) => Number.parseFloat(value);
  const w = px(element.style.width);
  const h = px(element.style.height);
  const left =
    element.style.left !== 'auto' && element.style.left !== ''
      ? px(element.style.left)
      : width - px(element.style.right) - w;
  const top = height - px(element.style.bottom) - h;
  return { left, top, right: left + w, bottom: top + h };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}
