import { describe, expect, it } from 'vitest';

import {
  anyWeather,
  sameDoc,
  setShafts,
  shaftSliders,
  shaftWeathers,
  slidersFor,
  toggleShaftWeather,
  weathers,
  type Hd2dDoc,
} from './controls';

/** Dusk Helm's field document (open-games `features/fields/field.hd2d.json`), trimmed. */
const field = (): Hd2dDoc => ({
  version: 1,
  lighting: {
    ambient: { color: '#e8f0ff', intensity: 0.85 },
    shafts: {
      direction: 1.2,
      color: '#fff0c2',
      intensity: 0.15,
      count: 3,
      reach: 0.6,
      cycle: 6,
      chance: 0.7,
      when: { biomes: ['forest'], weather: ['clear', 'partly-cloudy'] },
    },
    clouds: { coverage: 0.42, scale: 0.55, speed: 0.06, direction: 0.4, shadow: 0.38, sun: 0.4 },
    lights: [
      {
        id: 'campfire',
        x: 0,
        y: 0,
        radius: 260,
        color: '#ff9a3c',
        intensity: 0.7,
        flicker: { amount: 0.3, rate: 7, seed: 3 },
      },
    ],
  },
  focus: { mode: 'depthBands', target: 'player', smoothing: 0.15, strength: 0.6, range: 0.25, hero: 'hero' },
  atmosphere: { haze: { color: '#c4d4e4', density: 0.25 } },
  particles: {
    emitters: [{ preset: 'forest-leaves', at: [0, 4, 0], density: 4 }],
    wind: { direction: [1, -0.25, 0.3], strength: 2.6, seed: 3 },
  },
});

const control = (doc: Hd2dDoc, id: string) =>
  [
    ...slidersFor('shafts', doc),
    ...slidersFor('clouds', doc),
    ...slidersFor('light', doc),
    ...slidersFor('focus', doc),
    ...slidersFor('particles', doc),
  ].find((entry) => entry.id === id)!;

describe('HD-2D controls', () => {
  // Kevin's ask: shaft frequency, count, reach and brightness, each a field the game's shafts read.
  it('writes each shaft control to its own field and leaves the reported document alone', () => {
    const doc = field();
    let next = control(doc, 'chance').set(doc, 0.2);
    next = control(next, 'count').set(next, 6);
    next = control(next, 'reach').set(next, 0.3);
    next = control(next, 'brightness').set(next, 0.5);
    expect(next.lighting.shafts).toMatchObject({ chance: 0.2, count: 6, reach: 0.3, intensity: 0.5 });
    expect(doc.lighting.shafts).toMatchObject({ chance: 0.7, count: 3, reach: 0.6, intensity: 0.15 });
  });

  // A beam with no cycle never fades; the slider's top end has to mean that, not a 30 s cycle.
  it('reads and writes "always" at the top of the stay slider', () => {
    const stay = control(field(), 'cycle');
    expect(stay.shown).toBe('6 s');
    const always = stay.set(field(), stay.max);
    expect(always.lighting.shafts).not.toHaveProperty('cycle');
    expect(control(always, 'cycle')).toMatchObject({ value: stay.max, shown: 'always' });
  });

  it('turns shafts off and back on with the settings Kevin had', () => {
    const doc = field();
    const off = setShafts(doc, false, undefined);
    expect(off.lighting.shafts).toBeUndefined();
    expect(shaftSliders(off)).toEqual([]);
    expect(setShafts(off, true, doc.lighting.shafts).lighting.shafts).toEqual(doc.lighting.shafts);
    expect(setShafts(off, true, undefined).lighting.shafts).toMatchObject({ count: 4, cycle: 8 });
  });

  // Weather gates decide whether shafts show at all; the biome gate stays as the agent set it.
  it('gates shafts by weather, and Any lets them through in every weather', () => {
    const doc = field();
    const offered = weathers(doc, 'rain');
    expect(offered).toEqual(['clear', 'partly-cloudy', 'overcast', 'rain']);
    const withRain = toggleShaftWeather(doc, 'rain', offered);
    expect(shaftWeathers(withRain)).toEqual(['clear', 'partly-cloudy', 'rain']);
    const noClear = toggleShaftWeather(withRain, 'clear', offered);
    expect(shaftWeathers(noClear)).toEqual(['partly-cloudy', 'rain']);
    const any = anyWeather(noClear);
    expect(shaftWeathers(any)).toBeUndefined();
    expect(any.lighting.shafts?.when).toEqual({ biomes: ['forest'] });
    expect(shaftWeathers(toggleShaftWeather(any, 'rain', offered))).toEqual(['clear', 'partly-cloudy', 'overcast']);
  });

  it('offers the weathers the scene names as well as the common ones', () => {
    expect(weathers(field(), 'snow')).toEqual(['clear', 'partly-cloudy', 'overcast', 'rain', 'snow']);
  });

  it('reaches lights, flicker, focus, haze, cloud shadows and particles', () => {
    const doc = field();
    expect(control(doc, 'light-0').label).toBe('Campfire');
    expect(control(doc, 'light-0-flicker').set(doc, 0.8).lighting.lights![0]!.flicker!.amount).toBe(0.8);
    expect(control(doc, 'haze').set(doc, 0.6).atmosphere.haze!.density).toBe(0.6);
    expect(control(doc, 'shadow').set(doc, 0.9).lighting.clouds!.shadow).toBe(0.9);
    expect(control(doc, 'emitter-0')).toMatchObject({ label: 'Leaves', shown: '4.0×' });
    expect(control(doc, 'wind').set(doc, 1).particles.wind.strength).toBe(1);
    expect(control(doc, 'warmth').set(doc, 0.4).lighting.grade).toEqual({
      temperature: 0.4,
      saturation: 1,
      contrast: 1,
    });
  });

  // three.js lights are in world units: a radius of 2 must not jump to the pixel scale's minimum of 10.
  it('ranges a light reach in the scene units', () => {
    const doc = field();
    doc.lighting.lights![0]!.radius = 2;
    expect(control(doc, 'light-0-radius')).toMatchObject({ min: 0.1, max: 9.9, value: 2 });
    expect(control(field(), 'light-0-radius')).toMatchObject({ min: 10, max: 1000, value: 260 });
  });

  it('treats the same fields in another key order as the same document', () => {
    expect(sameDoc({ a: 1, b: { c: 2, d: [1, 2] } }, { b: { d: [1, 2], c: 2 }, a: 1 })).toBe(true);
    expect(sameDoc({ a: 1, b: [1, 2] }, { a: 1, b: [2, 1] })).toBe(false);
  });
});
