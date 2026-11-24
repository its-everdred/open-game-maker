import type { EffekseerContext, EffekseerEffect, EffekseerHandle } from 'effekseer-runtime';

import { createFrameGovernor, DEFAULT_FRAME_BUDGET, type FrameBudget, type Hd2dQuality } from '../hd2d/quality.js';
import type { VfxCamera } from './camera.js';
import { createFinishPass, parsePalette } from './finish.js';
import { loadEffekseer } from './runtime.js';

export type VfxQuality = Hd2dQuality;

export interface VfxOptions {
  /** The game's canvas. Effects draw on their own canvas laid exactly over it, so the game's WebGL state is untouched. */
  canvas: HTMLCanvasElement;
  /** URL of `@gm/sdk/vfx/effekseer.wasm`; in a Vite game, `import wasmUrl from '@gm/sdk/vfx/effekseer.wasm?url'`. */
  wasmUrl: string;
  /** CSS pixels per effect pixel. Pixel games set their art scale: effects render that coarse and upscale with hard pixels. */
  pixelSize?: number;
  /** Optional `#rrggbb` palette (up to 16): every kept effect pixel becomes its nearest colour, opaque. */
  palette?: readonly string[];
  /** Pixels at or under this coverage (0–1) are dropped. Defaults to 0.25 with a palette, otherwise 0. */
  alphaCutoff?: number;
  /** Most effects playing at once at high quality; low quality halves it and `play` refuses past it. Default 24. */
  maxEffects?: number;
  /** Effekseer's per-scene particle caps (instances and drawn sprites). Defaults 800 and 1600. */
  maxInstances?: number;
  maxSprites?: number;
  /** Starting quality; `pickQuality` from `@gm/sdk/hd2d` gives the device default. Default `high`. */
  quality?: VfxQuality;
  /** Slow frames step quality down (high, low, off) and never back up. */
  budget?: FrameBudget;
}

export interface VfxHandle {
  readonly alive: boolean;
  moveTo(x: number, y: number, z?: number): void;
  stop(): void;
}

export interface VfxStats {
  quality: VfxQuality;
  /** Effects still playing. */
  effects: number;
  /** Particle instances in use, out of `maxInstances`. */
  instances: number;
  /** Main-thread milliseconds the last frame spent simulating effects. */
  updateMs: number;
  /** Main-thread milliseconds the last frame spent submitting draws (a GPU stall shows up here, not its GPU time). */
  drawMs: number;
}

export interface Vfx {
  readonly canvas: HTMLCanvasElement;
  readonly quality: VfxQuality;
  /** Loads an `.efk` (its textures resolve next to it). `scale` multiplies authored units, e.g. world pixels per unit. */
  load(name: string, url: string, scale?: number): Promise<void>;
  /** Starts a loaded effect at a world position; `null` when effects are off or the scene is at its cap. */
  play(name: string, x: number, y: number, z?: number): VfxHandle | null;
  setCamera(camera: VfxCamera): void;
  /** Advances and draws every effect. Call once per game frame with the frame's duration. */
  frame(deltaMs: number): void;
  stats(): VfxStats;
  stopAll(): void;
  destroy(): void;
}

const DEFAULTS = { maxEffects: 24, maxInstances: 800, maxSprites: 1600 };
/** Effects are authored at 60 frames a second. */
const FRAME_MS = 1000 / 60;
/** A longer gap (a hidden tab, a debugger) advances effects this far, not by the whole gap. */
const MAX_STEP_MS = 100;

interface Playing {
  handle: EffekseerHandle;
}

function overlay(game: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = game.ownerDocument.createElement('canvas');
  canvas.dataset.gmVfx = 'true';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'absolute', pointerEvents: 'none', imageRendering: 'pixelated' });
  game.insertAdjacentElement('afterend', canvas);
  return canvas;
}

/** Lays the overlay over the game canvas and sizes its buffer; returns the buffer size. */
function fit(canvas: HTMLCanvasElement, game: HTMLCanvasElement, pixelSize: number | undefined): [number, number] {
  const width = game.clientWidth;
  const height = game.clientHeight;
  const style = canvas.style;
  style.left = `${game.offsetLeft}px`;
  style.top = `${game.offsetTop}px`;
  style.width = `${width}px`;
  style.height = `${height}px`;
  const density = pixelSize ? 1 / pixelSize : (game.ownerDocument.defaultView?.devicePixelRatio ?? 1);
  const w = Math.max(1, Math.round(width * density));
  const h = Math.max(1, Math.round(height * density));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  return [w, h];
}

/** Creates a scene's effects layer, loading the Effekseer runtime on first use. Destroy it when the scene ends. */
export async function createVfx(options: VfxOptions): Promise<Vfx> {
  const runtime = await loadEffekseer(options.wasmUrl);
  const canvas = overlay(options.canvas);
  fit(canvas, options.canvas, options.pixelSize);
  const attributes: WebGLContextAttributes = {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
  };
  const gl = canvas.getContext('webgl2', attributes) ?? canvas.getContext('webgl', attributes);
  if (!gl) {
    canvas.remove();
    throw new Error('vfx needs WebGL');
  }
  const palette = parsePalette(options.palette ?? []);
  const finish = createFinishPass(gl, palette, options.alphaCutoff ?? (palette.length ? 0.25 : 0));
  const context: EffekseerContext = runtime.createContext();
  const maxInstances = options.maxInstances ?? DEFAULTS.maxInstances;
  context.init(gl, { instanceMaxCount: maxInstances, squareMaxCount: options.maxSprites ?? DEFAULTS.maxSprites });

  const effects = new Map<string, EffekseerEffect>();
  /** Loads by name: a second load of a name shares the first, so effects are never loaded twice or orphaned. */
  const loads = new Map<string, Promise<void>>();
  /** Loads still waiting on textures: the native context outlives them, or their callbacks would touch freed memory. */
  const inflight = new Set<Promise<unknown>>();
  const playing: Playing[] = [];
  const governor = createFrameGovernor(options.budget ?? DEFAULT_FRAME_BUDGET);
  const maxEffects = options.maxEffects ?? DEFAULTS.maxEffects;
  let quality: VfxQuality = options.quality ?? 'high';
  let camera: VfxCamera | undefined;
  let updateMs = 0;
  let drawMs = 0;
  let destroyed = false;

  const cap = () => (quality === 'high' ? maxEffects : quality === 'low' ? Math.floor(maxEffects / 2) : 0);
  const prune = () => {
    for (let i = playing.length - 1; i >= 0; i--) if (!playing[i]!.handle.exists) playing.splice(i, 1);
  };
  /** Stops the oldest effects past the current cap. */
  const shed = () => {
    while (playing.length > cap()) playing.shift()!.handle.stop();
    canvas.style.visibility = quality === 'off' ? 'hidden' : '';
  };

  async function loadEffect(name: string, url: string, scale: number): Promise<void> {
    // The runtime's loader ignores HTTP status and never settles on a file it cannot parse, so fetch and check here.
    const response = await fetch(url);
    if (!response.ok) throw new Error(`vfx ${name}: ${response.status} ${url}`);
    const buffer = await response.arrayBuffer();
    if (destroyed) throw new Error(`vfx ${name}: destroyed while loading`);
    const base = new URL(url, canvas.ownerDocument.baseURI);
    let done!: () => void;
    let fail!: (error: Error) => void;
    const textures = new Promise<void>((resolve, reject) => {
      done = resolve;
      fail = reject;
    });
    const effect = context.loadEffect(
      buffer,
      scale,
      () => done(),
      (reason, path) => fail(new Error(`vfx ${name}: ${reason} (${path})`)),
      // Textures resolve next to the .efk, as they do when the runtime fetches it by URL.
      (path) => new URL(path, base).href,
    );
    if (!effect.nativeptr) throw new Error(`vfx ${name}: not an Effekseer effect (${url})`);
    inflight.add(textures);
    try {
      await textures;
    } finally {
      inflight.delete(textures);
    }
    // destroy() releases the context only after in-flight loads settle, so this effect can still be released.
    if (destroyed) {
      context.releaseEffect(effect);
      throw new Error(`vfx ${name}: destroyed while loading`);
    }
    effects.set(name, effect);
  }

  const releaseNative = () => {
    for (const effect of effects.values()) context.releaseEffect(effect);
    effects.clear();
    runtime.releaseContext(context);
    finish.dispose();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  };

  const vfx: Vfx = {
    canvas,
    get quality() {
      return quality;
    },
    load(name, url, scale = 1) {
      let loading = loads.get(name);
      if (!loading) {
        loading = loadEffect(name, url, scale);
        loads.set(name, loading);
        loading.catch(() => loads.delete(name));
      }
      return loading;
    },
    play(name, x, y, z = 0) {
      const effect = effects.get(name);
      if (!effect) throw new RangeError(`vfx effect not loaded: ${name}`);
      prune();
      if (destroyed || playing.length >= cap()) return null;
      const yDown = camera?.yDown ?? true;
      const handle = context.play(effect, x, yDown ? -y : y, z);
      if (!handle) return null;
      const entry = { handle };
      playing.push(entry);
      return {
        get alive() {
          return !destroyed && playing.includes(entry) && handle.exists;
        },
        moveTo(nx, ny, nz = 0) {
          if (!destroyed && handle.exists) handle.setLocation(nx, yDown ? -ny : ny, nz);
        },
        stop() {
          if (!destroyed) handle.stop();
        },
      };
    },
    setCamera(next) {
      camera = next;
      if (destroyed) return;
      context.setProjectionMatrix(next.projection);
      context.setCameraMatrix(next.view);
    },
    frame(deltaMs) {
      if (destroyed) return;
      const next = governor.sample(deltaMs, quality);
      if (next !== quality) {
        quality = next;
        shed();
      }
      if (quality === 'off') return;
      const start = performance.now();
      context.update(Math.min(Math.max(deltaMs, 0), MAX_STEP_MS) / FRAME_MS);
      const updated = performance.now();
      const [width, height] = fit(canvas, options.canvas, options.pixelSize);
      finish.begin(width, height);
      context.draw();
      finish.end();
      updateMs = updated - start;
      drawMs = performance.now() - updated;
    },
    stats() {
      if (destroyed) return { quality, effects: 0, instances: 0, updateMs: 0, drawMs: 0 };
      prune();
      return {
        quality,
        effects: playing.length,
        instances: maxInstances - context.getRestInstancesCount(),
        updateMs,
        drawMs,
      };
    },
    stopAll() {
      if (destroyed) return;
      context.stopAll();
      playing.length = 0;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      context.stopAll();
      playing.length = 0;
      canvas.remove();
      if (inflight.size) void Promise.allSettled([...inflight]).then(releaseNative);
      else releaseNative();
    },
  };
  return vfx;
}
