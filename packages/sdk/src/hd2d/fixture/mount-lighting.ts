import { Mesh, type MeshBasicMaterial } from 'three';
import type Phaser from 'phaser';
import { createLighting, DEFAULT_FOREST_LIGHTING, type LightingSprite } from '../lighting/index.js';
import type { Mount } from './mount.js';
import { FIXTURE_SKY } from './sky-preset.js';

/** The forest preset (or, with `sky=1`, short beams and clouds) plus one flickering lantern; the hero gets its normal map. */
const mountLighting: Mount = (ctx) => {
  const three = ctx.three;
  // Lights are in world units: Phaser is y-down screen pixels, the three.js fixture is y-up.
  const lantern = { id: 'lantern', x: 470, y: three ? 360 - 285 : 285, radius: 80, color: '#ffb35c', intensity: 0.9 };
  const params = new URLSearchParams(location.search);
  const sky = params.get('sky') === '1';
  const preset = {
    ...(sky ? FIXTURE_SKY : DEFAULT_FOREST_LIGHTING),
    // Seed 2 swings from dim at 0 ms to bright at 500 ms, which the browser spec checks.
    lights: [{ ...lantern, flicker: { amount: 0.55, rate: 6, seed: 2 } }],
  };
  const target = three ? { three } : { phaser: { scene: ctx.phaser!.scene } };
  const lighting = createLighting(target, preset, { quality: ctx.quality, seed: ctx.seed });
  let hero: LightingSprite | undefined;
  if (three)
    three.scene.traverse((object) => {
      if (object instanceof Mesh && (object.material as MeshBasicMaterial).map?.image === ctx.art.hero) hero = object;
    });
  else
    hero = ctx.phaser!.scene.children.list.find(
      (object): object is Phaser.GameObjects.Image => (object as Phaser.GameObjects.Image).texture?.key === 'hero',
    );
  if (!hero) throw new Error('fixture hero sprite not found');
  lighting.setNormalMap(hero, ctx.art.heroNormal);
  lighting.setConditions({ biome: 'forest', weather: params.get('weather') ?? 'clear' });
  return lighting;
};
export default mountLighting;
