import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Hd2dDoc } from './controls';
import { Hd2dPanel } from './Hd2dPanel';

const scene = (intensity = 0.4): Hd2dDoc => ({
  version: 1,
  lighting: {
    ambient: { color: '#ffffff', intensity: 1 },
    shafts: {
      direction: 1.1,
      color: '#ffd77a',
      intensity,
      count: 5,
      cycle: 8,
      chance: 0.8,
      when: { weather: ['clear'] },
    },
  },
  focus: { mode: 'depthBands', target: 'player', smoothing: 0.15, strength: 0.6, range: 0.25 },
  atmosphere: {},
  particles: { emitters: [], wind: { direction: [1, 0, 0], strength: 1, seed: 1 } },
});

/* requestAnimationFrame by hand: the panel sends once per frame. */
let frames: FrameRequestCallback[] = [];
const nextFrame = () =>
  act(() => {
    const due = frames;
    frames = [];
    for (const callback of due) callback(0);
  });

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const slider = (name: string) => screen.getByRole('slider', { name });

describe('Hd2dPanel', () => {
  it('stays out of the way of a game without HD-2D', () => {
    const { rerender } = render(<Hd2dPanel apply={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Lighting' })).toBeNull();
    rerender(<Hd2dPanel report={{ doc: null }} apply={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Lighting' })).toBeNull();
  });

  // Live preview: a drag sends the newest value once a frame, and the game's echo never pulls the slider back.
  it('sends the latest edit once per frame and keeps it through the late echoes', () => {
    const apply = vi.fn();
    const { rerender } = render(<Hd2dPanel report={{ doc: scene(), weather: 'clear' }} apply={apply} />);
    fireEvent.click(screen.getByRole('button', { name: 'Lighting' }));
    fireEvent.change(slider('Brightness'), { target: { value: '0.5' } });
    fireEvent.change(slider('Brightness'), { target: { value: '0.6' } });
    expect(apply).not.toHaveBeenCalled();
    nextFrame();
    expect(apply).toHaveBeenCalledOnce();
    expect(apply.mock.calls[0]![0].lighting.shafts.intensity).toBe(0.6);
    expect(apply.mock.calls[0]![1]).toBe('clear');

    fireEvent.change(slider('Brightness'), { target: { value: '0.7' } });
    nextFrame();
    /* The game reports the 0.6 edit after Kevin has already moved on to 0.7. */
    rerender(<Hd2dPanel report={{ doc: apply.mock.calls[0]![0], weather: 'clear' }} apply={apply} />);
    expect(slider('Brightness')).toHaveProperty('value', '0.7');
  });

  it('starts over from a new scene, and Reset returns to how the scene started', () => {
    const apply = vi.fn();
    const { rerender } = render(<Hd2dPanel report={{ doc: scene() }} apply={apply} />);
    fireEvent.click(screen.getByRole('button', { name: 'Lighting' }));
    expect(screen.getByRole('button', { name: 'Reset lighting' })).toHaveProperty('disabled', true);
    fireEvent.change(slider('Beams'), { target: { value: '9' } });
    nextFrame();
    fireEvent.click(screen.getByRole('button', { name: 'Reset lighting' }));
    nextFrame();
    expect(apply.mock.lastCall![0].lighting.shafts.count).toBe(5);

    rerender(<Hd2dPanel report={{ doc: scene(0.9) }} apply={apply} />);
    expect(slider('Brightness')).toHaveProperty('value', '0.9');
  });

  // Weather gates: Kevin previews another weather and decides which ones let the shafts through.
  it('previews a weather and gates shafts by it', () => {
    const apply = vi.fn();
    render(<Hd2dPanel report={{ doc: scene(), weather: 'clear' }} apply={apply} />);
    fireEvent.click(screen.getByRole('button', { name: 'Lighting' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Weather' }));
    const preview = screen.getByRole('group', { name: 'Preview' });
    fireEvent.click(preview.querySelector('button:nth-of-type(4)')!);
    nextFrame();
    expect(apply.mock.lastCall![1]).toBe('rain');

    const gate = screen.getByRole('group', { name: 'Shafts in' });
    fireEvent.click([...gate.querySelectorAll('button')].find((button) => button.textContent === 'Rain')!);
    nextFrame();
    expect(apply.mock.lastCall![0].lighting.shafts.when.weather).toEqual(['clear', 'rain']);
  });

  it('switches cloud shadows on with a default look and off again', () => {
    const apply = vi.fn();
    render(<Hd2dPanel report={{ doc: scene() }} apply={apply} />);
    fireEvent.click(screen.getByRole('button', { name: 'Lighting' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Clouds' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Cloud shadows' }));
    nextFrame();
    expect(apply.mock.lastCall![0].lighting.clouds).toMatchObject({ coverage: 0.45 });
    expect(slider('Shade')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Cloud shadows' }));
    nextFrame();
    expect(apply.mock.lastCall![0].lighting.clouds).toBeUndefined();
  });
});
