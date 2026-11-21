import { Scene, OrthographicCamera, type WebGLRenderer } from 'three';
import type Phaser from 'phaser';
import { describe, expect, it, vi } from 'vitest';

import { createFocus, focusBackend, focusPlan, type FocusTarget } from './create.js';
import { DEFAULT_FOCUS } from './schema.js';

const phaserTarget = (renderer: object): FocusTarget => ({
  phaser: {
    scene: { renderer, children: { list: [] }, cameras: { main: { height: 360 } } } as unknown as Phaser.Scene,
  },
});

describe('focus backend selection', () => {
  it('picks three.js, Phaser WebGL, or nothing for Phaser Canvas', () => {
    const renderer = { render: vi.fn() } as unknown as WebGLRenderer;
    expect(focusBackend({ three: { renderer, scene: new Scene() } })).toBe('three');
    expect(focusBackend(phaserTarget({ gl: {} }))).toBe('phaser');
    expect(focusBackend(phaserTarget({ gameCanvas: {} }))).toBe('none');
  });

  it('runs a Phaser Canvas scene with no focus effect and no error', () => {
    const focus = createFocus(phaserTarget({ gameCanvas: {} }));
    expect(() => {
      focus.update(0);
      focus.setQuality('low');
      focus.update(16);
      focus.dispose();
    }).not.toThrow();
  });
});

describe('focus quality fallbacks', () => {
  it('bypasses everything at off, renders at half resolution at low, and enables DOF only at high', () => {
    expect(focusPlan({ ...DEFAULT_FOCUS, quality: 'off' })).toEqual({ bypass: true, scale: 1, bokeh: false });
    expect(focusPlan({ ...DEFAULT_FOCUS, quality: 'low' })).toEqual({ bypass: false, scale: 0.5, bokeh: false });
    expect(focusPlan({ ...DEFAULT_FOCUS, quality: 'high' })).toEqual({ bypass: false, scale: 1, bokeh: false });
    expect(focusPlan({ ...DEFAULT_FOCUS, mode: 'depthOfField', quality: 'high' }).bokeh).toBe(true);
    expect(focusPlan({ ...DEFAULT_FOCUS, mode: 'depthOfField', quality: 'low' }).bokeh).toBe(false);
  });

  it('caps effect buffers at 1.5 device pixels per CSS pixel', () => {
    expect(focusPlan({ ...DEFAULT_FOCUS, quality: 'high' }, 3).scale).toBe(0.5);
    expect(focusPlan({ ...DEFAULT_FOCUS, quality: 'low' }, 3).scale).toBe(0.25);
  });

  it('hands three.js renders straight through at quality off, and restores render() on dispose', () => {
    const render = vi.fn();
    const renderer = { render, getRenderTarget: () => null } as unknown as WebGLRenderer;
    const scene = new Scene();
    const camera = new OrthographicCamera();
    const focus = createFocus(
      { three: { renderer, scene, camera } },
      { ...DEFAULT_FOCUS, quality: 'off' },
      { haze: { color: '#ffffff', distance: 10 } },
    );
    expect(renderer.render).not.toBe(render);
    renderer.render(scene, camera);
    expect(render).toHaveBeenCalledWith(scene, camera);
    expect(scene.fog).toBeNull();
    focus.dispose();
    expect(renderer.render).toBe(render);
  });

  it('rejects invalid config at the boundary', () => {
    const focus = createFocus(phaserTarget({ gameCanvas: {} }));
    expect(() => focus.configure({ ...DEFAULT_FOCUS, strength: 2 })).toThrow();
    expect(() => focus.setAtmosphere({ haze: { color: 'red' } })).toThrow();
  });
});
