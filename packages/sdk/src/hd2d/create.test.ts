import { Object3D, OrthographicCamera, Scene, type WebGLRenderer } from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ log: [] as string[], created: [] as { kind: string; args: unknown[] }[] }));

function fake(kind: string, args: unknown[]) {
  calls.created.push({ kind, args });
  const record =
    (name: string) =>
    (...values: unknown[]) =>
      calls.log.push(`${kind}.${name}(${values.map((value) => JSON.stringify(value)).join(',')})`);
  return {
    apply: record('apply'),
    configure: record('configure'),
    setAtmosphere: record('setAtmosphere'),
    setQuality: record('setQuality'),
    setWind: record('setWind'),
    emit: record('emit'),
    update: record('update'),
    dispose: record('dispose'),
  };
}

vi.mock('./lighting/index.js', () => ({ createLighting: (...args: unknown[]) => fake('lighting', args) }));
vi.mock('./focus/index.js', () => ({ createFocus: (...args: unknown[]) => fake('focus', args) }));
vi.mock('./particles/index.js', () => ({ createParticles: (...args: unknown[]) => fake('particles', args) }));

const { createHd2d } = await import('./create.js');
const { HD2D_FOREST_DEFAULTS } = await import('./scene.js');

function threeTarget() {
  const scene = new Scene();
  const hero = new Object3D();
  hero.name = 'hero';
  scene.add(hero);
  const renderer = {} as WebGLRenderer;
  return { target: { three: { renderer, scene, camera: new OrthographicCamera() } }, hero };
}

const created = (kind: string) => calls.created.filter((entry) => entry.kind === kind);
const logged = (prefix: string) => calls.log.filter((line) => line.startsWith(prefix));

beforeEach(() => {
  calls.log.length = 0;
  calls.created.length = 0;
});

describe('createHd2d', () => {
  it('builds all three backends from one scene document at one quality', () => {
    const { target, hero } = threeTarget();
    const config = { ...HD2D_FOREST_DEFAULTS, focus: { ...HD2D_FOREST_DEFAULTS.focus, hero: 'hero' } };
    createHd2d(target, config, { quality: 'low', seed: 7 });
    const [lighting] = created('lighting');
    expect(lighting!.args.slice(1)).toEqual([HD2D_FOREST_DEFAULTS.lighting, { quality: 'low', seed: 7 }]);
    const [focus] = created('focus');
    expect((focus!.args[0] as { three: { hero: unknown } }).three.hero).toBe(hero);
    expect(focus!.args[1]).toEqual({ ...HD2D_FOREST_DEFAULTS.focus, quality: 'low' });
    const [particles] = created('particles');
    expect(particles!.args[1]).toMatchObject({ quality: 'low', seed: 7, wind: HD2D_FOREST_DEFAULTS.particles.wind });
    expect(logged('particles.emit')).toEqual([
      'particles.emit("0",{"at":[0,0,0],"intensity":1})',
      'particles.emit("1",{"at":[0,0,0],"intensity":1})',
    ]);
  });

  it('sends setQuality to lighting, focus and particles', () => {
    const hd2d = createHd2d(threeTarget().target, HD2D_FOREST_DEFAULTS, { quality: 'high' });
    hd2d.setQuality('low');
    expect(logged('lighting.setQuality').concat(logged('focus.setQuality'), logged('particles.setQuality'))).toEqual([
      'lighting.setQuality("low")',
      'focus.setQuality("low")',
      'particles.setQuality("low")',
    ]);
    expect(hd2d.quality).toBe('low');
  });

  it('steps the tier down on all three backends after N slow frames', () => {
    const budget = { frameMs: 33, slowFrames: 3 };
    const hd2d = createHd2d(threeTarget().target, HD2D_FOREST_DEFAULTS, { quality: 'high', budget });
    let time = 0;
    for (let frame = 0; frame < 3; frame += 1) hd2d.update((time += 50));
    expect(hd2d.quality).toBe('high');
    hd2d.update(time + 50);
    expect(hd2d.quality).toBe('low');
    expect(logged('lighting.setQuality')).toEqual(['lighting.setQuality("low")']);
    expect(logged('focus.setQuality')).toEqual(['focus.setQuality("low")']);
    expect(logged('particles.setQuality')).toEqual(['particles.setQuality("low")']);
  });

  it('keeps the tier fixed when the budget is off', () => {
    const hd2d = createHd2d(threeTarget().target, HD2D_FOREST_DEFAULTS, { quality: 'high', budget: false });
    for (let time = 0; time < 5000; time += 100) hd2d.update(time);
    expect(hd2d.quality).toBe('high');
  });

  it('applies a running scene in place and restarts only what changed', () => {
    const hd2d = createHd2d(threeTarget().target, HD2D_FOREST_DEFAULTS);
    calls.log.length = 0;
    const lit = { ...HD2D_FOREST_DEFAULTS.lighting, ambient: { color: '#ffffff', intensity: 1 } };
    hd2d.applyScene({ ...HD2D_FOREST_DEFAULTS, lighting: lit });
    expect(logged('lighting.apply')).toEqual([`lighting.apply(${JSON.stringify(lit)})`]);
    expect(created('focus')).toHaveLength(1);
    expect(created('particles')).toHaveLength(1);

    hd2d.applyScene({ ...HD2D_FOREST_DEFAULTS, particles: { ...HD2D_FOREST_DEFAULTS.particles, emitters: [] } });
    expect(logged('particles.dispose')).toHaveLength(1);
    expect(created('particles')).toHaveLength(2);

    hd2d.applyScene({ ...HD2D_FOREST_DEFAULTS, focus: { ...HD2D_FOREST_DEFAULTS.focus, hero: 'hero' } });
    expect(logged('focus.dispose')).toHaveLength(1);
    expect(created('focus')).toHaveLength(2);
  });

  it('rejects an invalid scene with the field path and keeps running the old one', () => {
    const hd2d = createHd2d(threeTarget().target, HD2D_FOREST_DEFAULTS);
    const broken = { ...HD2D_FOREST_DEFAULTS, focus: { ...HD2D_FOREST_DEFAULTS.focus, range: 5 } };
    expect(() => hd2d.applyScene(broken)).toThrow(/focus\.range/);
    expect(logged('lighting.apply')).toEqual([]);
  });
});
