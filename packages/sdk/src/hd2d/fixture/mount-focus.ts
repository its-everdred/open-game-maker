import type Phaser from 'phaser';
import type { Object3D } from 'three';

import { createFocus, DEFAULT_FOCUS, type FocusTarget, type SceneAtmosphere } from '../focus/index.js';
import type { Mount } from './mount.js';

const mountFocus: Mount = (ctx) => {
  // Haze tints the ground behind the hero, so it is opt-in (`haze=1`) and off for the pixel-protect check.
  const atmosphere: SceneAtmosphere =
    new URLSearchParams(location.search).get('haze') === '1'
      ? { haze: { color: '#9ba99a', distance: ctx.renderer === 'three' ? 900 : 60, density: 0.6 } }
      : {};
  let target: FocusTarget;
  if (ctx.renderer === 'three') {
    let hero: Object3D | undefined;
    ctx.three!.scene.traverse((object) => {
      const map = (object as Object3D & { material?: { map?: { image?: unknown } } }).material?.map;
      if (map?.image === ctx.art.hero) hero = object;
    });
    target = { three: { ...ctx.three!, hero } };
  } else {
    const scene = ctx.phaser!.scene;
    const hero = scene.children.list.find((object) => (object as Phaser.GameObjects.Image).texture?.key === 'hero');
    target = { phaser: { scene, hero } };
  }
  const focus = createFocus(target, { ...DEFAULT_FOCUS, quality: ctx.quality }, atmosphere);
  return { update: (timeMs) => focus.update(timeMs), dispose: () => focus.dispose() };
};
export default mountFocus;
