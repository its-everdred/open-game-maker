import type { Object3D, WebGLRenderer } from 'three';
import type Phaser from 'phaser';

import type { PhaserRigDeps } from '../../camera/index.js';
import type { ThreeRigDeps } from '../../camera/three/base.js';
import { createFocusFollower } from './follow.js';
import { createPhaserFocus } from './phaser.js';
import {
  DEFAULT_FOCUS,
  focusConfigSchema,
  sceneAtmosphereSchema,
  type FocusConfig,
  type SceneAtmosphere,
} from './schema.js';
import { createThreeFocus } from './three.js';

/** `RigDeps` plus what focus needs: the three.js renderer and the hero that must stay crisp. */
export type ThreeFocusDeps = ThreeRigDeps & { renderer: WebGLRenderer; hero?: Object3D };
export type PhaserFocusDeps = PhaserRigDeps & { hero?: Phaser.GameObjects.GameObject };
export type FocusTarget = { three: ThreeFocusDeps } | { phaser: PhaserFocusDeps };

export interface FocusState {
  config: FocusConfig;
  atmosphere: SceneAtmosphere;
  follower: ReturnType<typeof createFocusFollower>;
}

export interface FocusBackend {
  update(timeMs: number): void;
  dispose(): void;
}

export interface Focus extends FocusBackend {
  configure(config: FocusConfig): void;
  setAtmosphere(atmosphere: SceneAtmosphere): void;
  setQuality(quality: FocusConfig['quality']): void;
  setFocusTarget(target: FocusConfig['target']): void;
}

/** Pixels (renderer units) of focus-point motion the follower ignores, so the focus band does not pump. */
const FOLLOW_DEADZONE = 0.5;
/** Research cap: effect buffers never exceed 1.5 device pixels per CSS pixel. */
const MAX_EFFECT_DPR = 1.5;

/** Which backend renders focus. Phaser's Canvas renderer has no filters, so it gets none (and no error). */
export function focusBackend(target: FocusTarget): 'three' | 'phaser' | 'none' {
  if ('three' in target) return 'three';
  return target.phaser.scene.renderer && 'gl' in target.phaser.scene.renderer ? 'phaser' : 'none';
}

/** Quality tiers: off bypasses everything, low renders effects at half resolution, high alone enables true DOF. */
export function focusPlan(config: FocusConfig, pixelRatio = 1): { bypass: boolean; scale: number; bokeh: boolean } {
  if (config.quality === 'off') return { bypass: true, scale: 1, bokeh: false };
  const dprCap = Math.min(1, MAX_EFFECT_DPR / Math.max(pixelRatio, Number.EPSILON));
  return {
    bypass: false,
    scale: (config.quality === 'low' ? 0.5 : 1) * dprCap,
    bokeh: config.mode === 'depthOfField' && config.quality === 'high',
  };
}

export function createFocus(
  target: FocusTarget,
  config: FocusConfig = DEFAULT_FOCUS,
  atmosphere: SceneAtmosphere = {},
): Focus {
  const parsed = focusConfigSchema.parse(config);
  const state: FocusState = {
    config: parsed,
    atmosphere: sceneAtmosphereSchema.parse(atmosphere),
    follower: createFocusFollower(parsed.smoothing, FOLLOW_DEADZONE),
  };
  const kind = focusBackend(target);
  const backend: FocusBackend =
    kind === 'none'
      ? { update() {}, dispose() {} }
      : 'three' in target
        ? createThreeFocus(target.three, state)
        : createPhaserFocus((target as { phaser: PhaserFocusDeps }).phaser, state);
  const reconfigure = (next: FocusConfig) => {
    const smoothing = state.config.smoothing;
    state.config = focusConfigSchema.parse(next);
    // Keep the follower (and its position) unless smoothing changed, so a new target eases in instead of snapping.
    if (state.config.smoothing !== smoothing)
      state.follower = createFocusFollower(state.config.smoothing, FOLLOW_DEADZONE);
  };
  return {
    configure: reconfigure,
    setAtmosphere(next) {
      state.atmosphere = sceneAtmosphereSchema.parse(next);
    },
    setQuality(quality) {
      state.config = focusConfigSchema.parse({ ...state.config, quality });
    },
    setFocusTarget(focusTarget) {
      reconfigure({ ...state.config, target: focusTarget });
    },
    update: (timeMs) => backend.update(timeMs),
    dispose: () => backend.dispose(),
  };
}
