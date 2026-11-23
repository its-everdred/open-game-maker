import type { Camera, Object3D, Scene, WebGLRenderer } from 'three';
import type Phaser from 'phaser';

import { linkHd2d } from '../core/hd2d-link.js';
import { createFocus, type Focus, type FocusTarget } from './focus/index.js';
import { createLighting, type Lighting, type LightingTarget, type SkyConditions } from './lighting/index.js';
import {
  createParticles,
  type Particles,
  type ParticlesOptions,
  type ParticlesTarget,
  type WindSettings,
} from './particles/index.js';
import { createFrameGovernor, DEFAULT_FRAME_BUDGET, type FrameBudget, type Hd2dQuality } from './quality.js';
import { emitterEffect, parseHd2dScene, type Hd2dSceneConfig } from './scene.js';

/**
 * What HD-2D draws into. three.js: the renderer, scene and camera the game renders with, and optionally the group
 * particles draw in (its scale sets the particle units). Phaser: the scene, and the screen pixels per particle unit.
 * Scene objects are found by name: `focus.hero` names a three.js object or a Phaser game object.
 */
export type Hd2dTarget =
  | { three: { renderer: WebGLRenderer; scene: Scene; camera: Camera; parent?: Object3D } }
  | { phaser: { scene: Phaser.Scene; scale?: number } };

export interface Hd2dOptions {
  quality?: Hd2dQuality;
  seed?: number;
  /** Drops the tier one step when frames stay over budget; `false` keeps the tier fixed. */
  budget?: FrameBudget | false;
}

export interface Hd2d {
  readonly lighting: Lighting;
  readonly focus: Focus;
  readonly particles: Particles;
  readonly quality: Hd2dQuality;
  setQuality(quality: Hd2dQuality): void;
  setWind(wind: Partial<WindSettings>): void;
  /** Re-renders a running scene from a new document (the editor's edits), without rebuilding the game. */
  applyScene(config: Hd2dSceneConfig): void;
  update(timeMs: number): void;
  dispose(): void;
}

/** The fixture's default: 252 of 360 rows, where a side-on hero stands. */
const DEFAULT_FOCUS_DEPTH = 0.7;

/**
 * Lighting, focus and particles on one target from one scene document, with one quality tier for all three. It links
 * itself to the editor: the map maker reads the document and conditions it renders and applies edits live.
 */
export function createHd2d(target: Hd2dTarget, config: Hd2dSceneConfig, options: Hd2dOptions = {}): Hd2d {
  let scene = parseHd2dScene(config);
  let quality: Hd2dQuality = options.quality ?? 'high';
  const seed = options.seed ?? 1;
  const governor = options.budget === false ? undefined : createFrameGovernor(options.budget ?? DEFAULT_FRAME_BUDGET);
  let lastTime: number | undefined;

  const findHero = (id: string | undefined) => {
    if (id === undefined) return undefined;
    return 'three' in target
      ? target.three.scene.getObjectByName(id)
      : (target.phaser.scene.children.getByName(id) ?? undefined);
  };
  const focusConfig = () => {
    const { mode, target: focusTarget, smoothing, strength, range } = scene.focus;
    return { mode, target: focusTarget, smoothing, strength, range, quality };
  };
  let boundHero: object | undefined;
  const makeFocus = (): Focus => {
    const hero = findHero(scene.focus.hero);
    boundHero = hero;
    const focusTarget: FocusTarget =
      'three' in target
        ? { three: { ...target.three, hero: hero as Object3D | undefined } }
        : { phaser: { scene: target.phaser.scene, hero: hero as Phaser.GameObjects.GameObject | undefined } };
    return createFocus(focusTarget, focusConfig(), scene.atmosphere);
  };
  // The particle driver reads these each frame, so lighting and focus edits reach the motes without a restart.
  const particleLook: Pick<ParticlesOptions, 'lighting' | 'focus'> = {};
  const syncParticleLook = () => {
    particleLook.lighting = scene.lighting;
    particleLook.focus = { config: focusConfig(), depth: scene.particles.focusDepth ?? DEFAULT_FOCUS_DEPTH };
  };
  const makeParticles = (): Particles => {
    syncParticleLook();
    const effects = Object.fromEntries(
      scene.particles.emitters.map((emitter, index) => [index, emitterEffect(emitter)]),
    );
    const particleTarget: ParticlesTarget = 'three' in target ? { three: target.three } : { phaser: target.phaser };
    const driver = createParticles(particleTarget, {
      wind: scene.particles.wind,
      effects,
      quality,
      seed,
      get lighting() {
        return particleLook.lighting;
      },
      get focus() {
        return particleLook.focus;
      },
    });
    scene.particles.emitters.forEach((emitter, index) =>
      driver.emit(String(index), { at: emitter.at, intensity: emitter.density ?? 1 }),
    );
    return driver;
  };

  const lightingTarget: LightingTarget =
    'three' in target ? { three: target.three } : { phaser: { scene: target.phaser.scene } };
  const core = createLighting(lightingTarget, scene.lighting, { quality, seed });
  let conditions: SkyConditions = {};
  /* The editor sees the document as set, not a gust the game sent through `setWind`. */
  let authored = scene;
  /* The editor shows the weather the game set, so the facade keeps track of it. */
  const lighting: Lighting = {
    ...core,
    setConditions(next) {
      conditions = { ...next };
      core.setConditions(next);
      link.changed();
    },
  };
  let focus = makeFocus();
  let particles = makeParticles();

  const setQuality = (next: Hd2dQuality) => {
    if (next === quality) return;
    quality = next;
    lighting.setQuality(next);
    focus.setQuality(next);
    particles.setQuality(next);
    syncParticleLook();
  };

  const hd2d: Hd2d = {
    lighting,
    get focus() {
      return focus;
    },
    get particles() {
      return particles;
    },
    get quality() {
      return quality;
    },
    setQuality(next) {
      governor?.reset();
      setQuality(next);
    },
    setWind(wind) {
      particles.setWind(wind);
      const { direction, strength, seed: windSeed } = { ...scene.particles.wind, ...wind };
      scene = {
        ...scene,
        particles: { ...scene.particles, wind: { direction: [...direction], strength, seed: windSeed } },
      };
    },
    applyScene(next) {
      const previous = scene;
      scene = parseHd2dScene(next);
      authored = scene;
      lighting.apply(scene.lighting);
      // A renamed, late-spawned or respawned hero rebinds focus; the same document re-applied repairs a stale one.
      if (findHero(scene.focus.hero) !== boundHero) {
        focus.dispose();
        focus = makeFocus();
      } else {
        focus.configure(focusConfig());
        focus.setAtmosphere(scene.atmosphere);
      }
      // Emitters restart from their seeds, so an applied scene draws what a fresh boot of it would.
      if (JSON.stringify(scene.particles) !== JSON.stringify(previous.particles)) {
        particles.dispose();
        particles = makeParticles();
      } else syncParticleLook();
      link.changed();
    },
    update(timeMs) {
      if (governor && lastTime !== undefined) setQuality(governor.sample(timeMs - lastTime, quality));
      lastTime = timeMs;
      lighting.update(timeMs);
      focus.update(timeMs);
      particles.update(timeMs);
    },
    dispose() {
      link.unlink();
      particles.dispose();
      focus.dispose();
      core.dispose();
    },
  };
  const link = linkHd2d({
    state: () => ({ doc: authored, ...conditions }),
    apply(doc, weather) {
      hd2d.applyScene(parseHd2dScene(doc));
      if (weather !== undefined && weather !== conditions.weather) lighting.setConditions({ ...conditions, weather });
    },
  });
  return hd2d;
}
