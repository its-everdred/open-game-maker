import { Group, Mesh, type MeshBasicMaterial } from 'three';
import type Phaser from 'phaser';

import { createHd2d, type Hd2d, type Hd2dTarget } from '../create.js';
import { HD2D_FOREST_DEFAULTS, serializeHd2dScene, type Hd2dSceneConfig } from '../scene.js';
import type { MountContext } from './mount.js';

/** Fixture pixels per particle unit, as in the particle mount. */
const SCALE = 64;

export interface FacadeHooks {
  hd2d: Hd2d;
  scene(): string;
}

/**
 * The clearing through `createHd2d`: the forest defaults with the lighting mount's lantern, the hero as the focus
 * target and the particle mount's emitters. `alt` boots a different scene, for applying the real one later.
 */
export default function mountFacade(ctx: MountContext, alt: boolean): FacadeHooks {
  const three = ctx.three;
  let hero: Mesh | Phaser.GameObjects.Image | undefined;
  let target: Hd2dTarget;
  if (three) {
    three.scene.traverse((object) => {
      if (object instanceof Mesh && (object.material as MeshBasicMaterial).map?.image === ctx.art.hero) hero = object;
    });
    const group = new Group();
    group.scale.setScalar(SCALE);
    group.position.z = 300;
    three.scene.add(group);
    target = { three: { ...three, parent: group } };
  } else {
    hero = ctx.phaser!.scene.children.list.find(
      (object): object is Phaser.GameObjects.Image => (object as Phaser.GameObjects.Image).texture?.key === 'hero',
    );
    target = { phaser: { scene: ctx.phaser!.scene, scale: SCALE } };
  }
  if (!hero) throw new Error('fixture hero sprite not found');
  hero.name = 'hero';

  const at = (x: number, y: number): [number, number, number] => [x / SCALE, (three ? 360 - y : -y) / SCALE, 0];
  const lantern = { id: 'lantern', x: 470, y: three ? 360 - 285 : 285, radius: 80, color: '#ffb35c', intensity: 0.9 };
  const scene: Hd2dSceneConfig = {
    ...HD2D_FOREST_DEFAULTS,
    lighting: {
      ...HD2D_FOREST_DEFAULTS.lighting,
      lights: [{ ...lantern, flicker: { amount: 0.55, rate: 6, seed: 2 } }],
    },
    focus: { ...HD2D_FOREST_DEFAULTS.focus, hero: 'hero' },
    atmosphere:
      new URLSearchParams(location.search).get('haze') === '1'
        ? { haze: { color: '#9ba99a', distance: three ? 900 : 60, density: 0.6 } }
        : {},
    particles: {
      emitters: [
        { preset: 'forest-leaves', at: at(320, 110) },
        { preset: 'forest-motes', at: at(320, 190) },
      ],
      wind: { direction: [1, -0.1, 0.2], strength: 0.4, seed: ctx.seed },
      focusDepth: 252 / 360,
    },
  };
  const boot: Hd2dSceneConfig = alt
    ? {
        ...scene,
        lighting: { ...scene.lighting, ambient: { color: '#3050a0', intensity: 0.2 }, lights: [] },
        focus: { ...scene.focus, mode: 'tiltShift' },
        particles: { ...scene.particles, emitters: [] },
      }
    : scene;
  // The fixture steps a virtual clock, so the frame budget would read its jumps as frame times.
  const hd2d = createHd2d(target, boot, { quality: ctx.quality, seed: ctx.seed, budget: false });
  hd2d.lighting.setNormalMap(hero, ctx.art.heroNormal);
  return { hd2d, scene: () => serializeHd2dScene(scene) };
}
