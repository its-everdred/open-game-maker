import { Group } from 'three';

import { DEFAULT_FOCUS } from '../focus/index.js';
import { DEFAULT_FOREST_LIGHTING } from '../lighting/index.js';
import { createParticles, type ParticlesTarget } from '../particles/index.js';
import type { Mount } from './mount.js';

/** Fixture pixels per pool unit: the forest presets' 12-unit boxes span the 640-pixel clearing. */
const SCALE = 64;
/** The hero's screen row (252 of 360): the depth the motes stay sharp at. */
const FOCUS_DEPTH = 252 / 360;

declare global {
  interface Window {
    /** The particle mount's info: how many particles the last frame drew. */
    __hd2dParticles?: { count(): number };
  }
}

/** The forest defaults: pixel leaves drifting through the clearing and soft motes catching the shafts. */
const mountParticles: Mount = (ctx) => {
  let group: Group | undefined;
  let target: ParticlesTarget;
  if (ctx.three) {
    // The three.js fixture is y-up in pixels; the group scales pool units to pixels in front of every sprite.
    group = new Group();
    group.scale.setScalar(SCALE);
    group.position.z = 300;
    ctx.three.scene.add(group);
    target = { three: { ...ctx.three, parent: group } };
  } else target = { phaser: { scene: ctx.phaser!.scene, scale: SCALE } };
  const particles = createParticles(target, {
    wind: { direction: [1, -0.1, 0.2], strength: 0.4, seed: ctx.seed },
    quality: ctx.quality,
    seed: ctx.seed,
    lighting: DEFAULT_FOREST_LIGHTING,
    focus: { config: { ...DEFAULT_FOCUS, quality: ctx.quality }, depth: FOCUS_DEPTH },
  });
  // Screen pixels (y down) to pool units (y up); Phaser flips y back, the three.js group does not need to.
  const at = (x: number, y: number): [number, number, number] => [x / SCALE, (ctx.three ? 360 - y : -y) / SCALE, 0];
  particles.emit('forest-leaves', { at: at(320, 110) });
  particles.emit('forest-motes', { at: at(320, 190) });
  window.__hd2dParticles = { count: () => particles.drawn };
  return {
    update: (timeMs) => particles.update(timeMs),
    dispose() {
      particles.dispose();
      group?.removeFromParent();
      delete window.__hd2dParticles;
    },
  };
};
export default mountParticles;
