import { createVfx, orthoCamera, type Vfx, type VfxOptions } from '../index.js';

/** World pixels per authored effect unit: the starter fire is about two units tall, so about 64 px here. */
const UNIT = 32;

interface StartOptions extends Pick<VfxOptions, 'pixelSize' | 'palette' | 'maxEffects' | 'budget'> {
  effects: string[];
}

const game = document.querySelector<HTMLCanvasElement>('#game')!;
const ctx = game.getContext('2d')!;
ctx.fillStyle = '#26323a';
ctx.fillRect(0, 0, game.width, game.height);
let vfx: Vfx | undefined;

function step(frames: number, ms: number) {
  for (let i = 0; i < frames; i++) vfx!.frame(ms);
}

window.__vfx = {
  ready: true,
  async start(options: StartOptions) {
    vfx = await createVfx({ canvas: game, wasmUrl: '/vfx/effekseer.wasm', ...options });
    await Promise.all(options.effects.map((name) => vfx!.load(name, `/vfx/effects/${name}.efk`, UNIT)));
    vfx.setCamera(orthoCamera({ x: 0, y: 0, width: game.width, height: game.height }));
  },
  play: (name: string, x: number, y: number) => vfx!.play(name, x, y) !== null,
  step,
  /** Draws the current state (no advance) and reads the effects canvas back, top row first. */
  capture() {
    vfx!.frame(0);
    const canvas = vfx!.canvas;
    // The same type returns the effects layer's own context; its buffer is still readable in this task.
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl'))!;
    const { width, height } = canvas;
    const raw = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    const data: number[] = [];
    for (let y = height - 1; y >= 0; y--) data.push(...raw.subarray(y * width * 4, (y + 1) * width * 4));
    return { width, height, data };
  },
  /** Median and 95th-percentile main-thread ms per frame, simulating and drawing, over `frames` frames. */
  cost(frames: number) {
    const update: number[] = [];
    const draw: number[] = [];
    for (let i = 0; i < frames; i++) {
      vfx!.frame(1000 / 60);
      const stats = vfx!.stats();
      update.push(stats.updateMs);
      draw.push(stats.drawMs);
    }
    const summary = (samples: number[]) => {
      samples.sort((a, b) => a - b);
      return { median: samples[Math.floor(frames / 2)]!, p95: samples[Math.floor(frames * 0.95)]! };
    };
    return { update: summary(update), draw: summary(draw), instances: vfx!.stats().instances };
  },
  stats: () => vfx!.stats(),
  rects: () => [game.getBoundingClientRect().toJSON(), vfx!.canvas.getBoundingClientRect().toJSON()],
  visibility: () => vfx!.canvas.style.visibility,
  destroy() {
    vfx!.destroy();
    return document.querySelectorAll('canvas[data-gm-vfx]').length;
  },
};

interface Cost {
  median: number;
  p95: number;
}

declare global {
  interface Window {
    __vfx?: {
      ready: boolean;
      start(options: StartOptions): Promise<void>;
      play(name: string, x: number, y: number): boolean;
      step(frames: number, ms: number): void;
      capture(): { width: number; height: number; data: number[] };
      cost(frames: number): { update: Cost; draw: Cost; instances: number };
      stats(): ReturnType<Vfx['stats']>;
      rects(): [DOMRectReadOnly, DOMRectReadOnly];
      visibility(): string;
      destroy(): number;
    };
  }
}
