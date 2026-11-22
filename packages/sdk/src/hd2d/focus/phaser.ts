import type Phaser from 'phaser';

import { blurForDepth, tiltShiftWeight } from './bands.js';
import { focusPlan, type FocusBackend, type FocusState, type PhaserFocusDeps } from './create.js';
import { hazeMix } from './haze.js';
import { screenOverlays } from '../overlays.js';

type Layer = Phaser.GameObjects.GameObject & {
  depth: number;
  y: number;
  enableFilters(): unknown;
  filters: { internal: Phaser.GameObjects.Components.FilterList } | null;
};
interface Applied {
  blur: Phaser.Filters.Blur;
  haze: Phaser.Filters.ColorMatrix;
}

const BLUR_STEPS = 4;
/** How far one Phaser blur pass reaches per unit offset: the low shader samples at 1.333, the medium at 3.23. */
const PASS_REACH = { low: 1.333, high: 3.2307692308 } as const;

function isLayer(object: Phaser.GameObjects.GameObject): object is Layer {
  const candidate = object as Partial<Layer>;
  return typeof candidate.enableFilters === 'function' && typeof candidate.depth === 'number';
}

/** The display-list child that holds `object`: itself, or its outermost container. */
function topLevel(object: Phaser.GameObjects.GameObject): Phaser.GameObjects.GameObject {
  let current = object;
  while (current.parentContainer) current = current.parentContainer;
  return current;
}

/**
 * Phaser focus: each display-list object is a layer, blurred by its depth band (or its screen band in
 * tilt-shift) with a per-object filter and hazed toward the haze colour by depth. The hero (or the container
 * holding it) gets no filter, so its pixels stay exactly as drawn; no camera-wide filter ever touches it.
 */
export function createPhaserFocus(deps: PhaserFocusDeps, state: FocusState): FocusBackend {
  const { scene } = deps;
  const hero = deps.hero && topLevel(deps.hero);
  const camera = deps.camera ?? scene.cameras.main;
  const applied = new Map<Layer, Applied>();
  let lastTime: number | undefined;
  let focus = { y: camera.height / 2, depth: Number.POSITIVE_INFINITY };
  let hazeColor: string | undefined;
  let hazeRgb = [0, 0, 0];

  function filtersFor(layer: Layer): Applied {
    let entry = applied.get(layer);
    if (!entry) {
      layer.enableFilters();
      const internal = layer.filters!.internal;
      entry = { haze: internal.addColorMatrix(), blur: internal.addBlur(0, 0, 0, 1, 0xffffff, BLUR_STEPS) };
      applied.set(layer, entry);
    }
    return entry;
  }

  return {
    update(timeMs) {
      const dt = lastTime === undefined ? 0 : timeMs - lastTime;
      lastTime = timeMs;
      const { config, atmosphere } = state;
      if (focusPlan(config).bypass) {
        for (const entry of applied.values()) entry.blur.active = entry.haze.active = false;
        return;
      }
      const layers = scene.children.list.filter(
        (object): object is Layer => object !== hero && isLayer(object) && !screenOverlays.has(object),
      );
      const heroLayer = hero && isLayer(hero) ? hero : undefined;
      const depths = layers.map((layer) => layer.depth).concat(heroLayer ? [heroLayer.depth] : []);
      const min = Math.min(...depths);
      const max = Math.max(...depths);
      const target = config.target;
      const point =
        target === 'player'
          ? heroLayer && { x: 0, y: heroLayer.y, z: heroLayer.depth }
          : { x: target.x, y: target.y, z: target.z ?? heroLayer?.depth ?? max };
      if (point) {
        const followed = state.follower.step(point, dt);
        focus = { y: followed.y, depth: followed.z ?? max };
      }
      const span = Math.max(max - min, Number.EPSILON);
      const focus01 = Math.min(1, (focus.depth - min) / span);
      const haze = atmosphere.haze;
      if (haze?.color !== hazeColor) {
        hazeColor = haze?.color;
        // ColorMatrix offsets are 0-255 and the filter works on unpremultiplied colour.
        hazeRgb = [1, 3, 5].map((at) => Number.parseInt((hazeColor ?? '#000000').slice(at, at + 2), 16));
      }
      const reach = PASS_REACH[config.quality === 'high' ? 'high' : 'low'] * BLUR_STEPS;
      for (const layer of layers) {
        const radius =
          config.mode === 'tiltShift'
            ? tiltShiftWeight(config, 0.5 + (layer.y - focus.y) / camera.height) * 12
            : blurForDepth(config, (layer.depth - min) / span, focus01);
        // In 2D, haze distance is measured in game-object depth units back from the nearest layer.
        const amount = hazeMix(atmosphere, max - layer.depth);
        if (radius <= 0.25 && amount === 0 && !applied.has(layer)) continue;
        const entry = filtersFor(layer);
        entry.blur.active = radius > 0.25;
        entry.blur.quality = config.quality === 'high' ? 1 : 0;
        entry.blur.x = entry.blur.y = radius / reach;
        entry.haze.active = amount > 0;
        const keep = 1 - amount;
        // prettier-ignore
        entry.haze.colorMatrix.set([
          keep, 0, 0, 0, amount * hazeRgb[0]!,
          0, keep, 0, 0, amount * hazeRgb[1]!,
          0, 0, keep, 0, amount * hazeRgb[2]!,
          0, 0, 0, 1, 0,
        ]);
      }
    },
    dispose() {
      for (const [layer, entry] of applied) {
        layer.filters?.internal.remove(entry.blur);
        layer.filters?.internal.remove(entry.haze);
      }
      applied.clear();
    },
  };
}
