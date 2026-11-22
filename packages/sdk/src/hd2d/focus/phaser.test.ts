import type Phaser from 'phaser';
import { describe, expect, it } from 'vitest';

import { screenOverlays } from '../overlays.js';
import { createFocus } from './create.js';
import { DEFAULT_FOCUS } from './schema.js';

interface FakeFilter {
  active: boolean;
  x?: number;
  colorMatrix?: { set(values: number[]): void };
}

function layer(depth: number, y = 180) {
  const list: FakeFilter[] = [];
  const object = {
    depth,
    y,
    parentContainer: null as unknown,
    filters: null as null | { internal: object },
    enableFilters() {
      object.filters ??= {
        internal: {
          addBlur: () => (list.push({ active: true, x: 0 }), list.at(-1)),
          addColorMatrix: () => (list.push({ active: true, colorMatrix: { set() {} } }), list.at(-1)),
          remove: (filter: FakeFilter) => list.splice(list.indexOf(filter), 1),
        },
      };
    },
  };
  return { object, list };
}

function scene(...objects: object[]) {
  return {
    renderer: { gl: {} },
    children: { list: objects },
    cameras: { main: { height: 360 } },
  } as unknown as Phaser.Scene;
}

describe('Phaser focus backend', () => {
  it('blurs far layers, never the hero, and bypasses and cleans up', () => {
    const far = layer(0);
    const hero = layer(50);
    const near = layer(60);
    const focus = createFocus(
      { phaser: { scene: scene(far.object, hero.object, near.object), hero: hero.object as never } },
      DEFAULT_FOCUS,
    );
    focus.update(0);
    expect(hero.object.filters).toBeNull();
    const blur = far.list.find((filter) => filter.x !== undefined)!;
    expect(blur.active).toBe(true);
    expect(blur.x).toBeGreaterThan(0);

    focus.setQuality('off');
    focus.update(16);
    expect(far.list.every((filter) => !filter.active)).toBe(true);

    focus.dispose();
    expect(far.list).toHaveLength(0);
  });

  it('keeps the container that holds the hero unfiltered', () => {
    const container = layer(50);
    const hero = layer(0);
    hero.object.parentContainer = container.object;
    const far = layer(0);
    const focus = createFocus(
      { phaser: { scene: scene(far.object, container.object), hero: hero.object as never } },
      DEFAULT_FOCUS,
    );
    focus.update(0);
    expect(container.object.filters).toBeNull();
    expect(far.list.length).toBeGreaterThan(0);
  });

  // Lighting draws its light field as images at depth 1e9; counted as layers they flattened every real band to 0 blur.
  it('ignores full-screen overlays when ranking layer depths', () => {
    const far = layer(0);
    const hero = layer(50);
    const near = layer(60);
    const overlay = layer(1e9);
    screenOverlays.add(overlay.object);
    const focus = createFocus(
      { phaser: { scene: scene(far.object, hero.object, near.object, overlay.object), hero: hero.object as never } },
      DEFAULT_FOCUS,
    );
    focus.update(0);
    expect(overlay.object.filters).toBeNull();
    expect(far.list.find((filter) => filter.x !== undefined)?.x).toBeGreaterThan(0);
  });
});
