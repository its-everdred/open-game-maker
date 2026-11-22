import Phaser from 'phaser';
import { WebGLRenderer } from 'three';
import { createPhaserScene, type ClearingScene } from './phaser-scene.js';
import { createThreeScene } from './three-scene.js';
import { createTestArt } from './testart.js';
import { parseHd2dScene } from '../scene.js';
import type { FrameStats } from './hooks.js';
import type { MountContext, Mounted } from './mount.js';
import mountLighting from './mount-lighting.js';
import mountFocus from './mount-focus.js';
import mountParticles from './mount-particles.js';
import mountFacade, { type FacadeHooks } from './mount-facade.js';

type RendererName = 'phaser' | 'three';
type Quality = 'off' | 'low' | 'high';
const capabilities = [
  ['lighting', mountLighting],
  ['focus', mountFocus],
  ['particles', mountParticles],
] as const;

const params = new URLSearchParams(location.search);
const rendererName: RendererName = params.get('renderer') === 'phaser' ? 'phaser' : 'three';
const seed = Number(params.get('seed') ?? 1) || 1;
const qualityValue = params.get('quality');
const quality: Quality = qualityValue === 'low' || qualityValue === 'high' ? qualityValue : 'off';
const enabled = capabilities.filter(([name]) => params.get(name) === '1');
const facade = params.get('facade') === '1';
if (facade && enabled.length !== capabilities.length)
  throw new Error('?facade=1 composes all three modules: add lighting=1&focus=1&particles=1');
const art = createTestArt(seed);
const found = document.querySelector<HTMLCanvasElement>('#game');
if (!found) throw new Error('HD-2D fixture canvas is missing');
const canvas: HTMLCanvasElement = found;

const mounts: Mounted[] = [];
let threeRenderer: WebGLRenderer | undefined;
let threeScene: ReturnType<typeof createThreeScene> | undefined;
let phaserScene: ClearingScene | undefined;
let facadeHooks: FacadeHooks | undefined;
/** Wall-clock ms of each `frame()` call, by the quality tier it ran at. */
const frameTimes: Record<Quality, number[]> = { off: [], low: [], high: [] };

function frameStats(): FrameStats {
  const stats: FrameStats = {};
  for (const [tier, times] of Object.entries(frameTimes) as [Quality, number[]][]) {
    if (!times.length) continue;
    const sorted = [...times].sort((a, b) => a - b);
    const mean = times.reduce((sum, time) => sum + time, 0) / times.length;
    stats[tier] = {
      mean,
      p95: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!,
      frames: times.length,
    };
  }
  return stats;
}

function hash(): string {
  const gl = threeRenderer?.getContext() ?? canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  if (!gl) throw new Error('fixture canvas has no readable WebGL context');
  const { width, height } = canvas;
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  let value = 0x811c9dc5;
  // WebGL reads bottom-up; hash rows top-down so the hash follows what the screen shows.
  for (let row = height - 1; row >= 0; row -= 1)
    for (let index = row * width * 4; index < (row + 1) * width * 4; index += 1)
      value = Math.imul(value ^ pixels[index], 0x01000193) >>> 0;
  return value.toString(16).padStart(8, '0');
}

async function frame(ms: number): Promise<void> {
  const started = performance.now();
  const tier = facadeHooks?.hd2d.quality ?? quality;
  phaserScene?.step(ms);
  threeScene?.step(ms);
  for (const mounted of mounts) mounted.update(ms);
  if (threeRenderer && threeScene) threeRenderer.render(threeScene.scene, threeScene.camera);
  // Phaser draws on its own loop; two animation frames guarantee one render after the step.
  else await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  frameTimes[tier].push(performance.now() - started);
}

async function start(): Promise<void> {
  let context: MountContext;
  if (rendererName === 'phaser') {
    phaserScene = createPhaserScene(art, seed);
    new Phaser.Game({
      type: Phaser.WEBGL,
      canvas,
      width: 640,
      height: 360,
      backgroundColor: '#172128',
      pixelArt: true,
      audio: { noAudio: true },
      scene: phaserScene,
      render: { antialias: false, pixelArt: true, preserveDrawingBuffer: true },
    });
    await phaserScene.created;
    context = { renderer: 'phaser', phaser: { scene: phaserScene }, art, quality, seed };
  } else {
    threeRenderer = new WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
    threeRenderer.setSize(640, 360, false);
    threeScene = createThreeScene(art, seed);
    context = {
      renderer: 'three',
      three: { renderer: threeRenderer, scene: threeScene.scene, camera: threeScene.camera },
      art,
      quality,
      seed,
    };
  }
  if (facade) {
    facadeHooks = mountFacade(context, params.get('boot') === 'alt');
    mounts.push(facadeHooks.hd2d);
  } else for (const [, factory] of enabled) mounts.push(factory(context));
  await frame(0);
  // The probe times stepped frames only, not the boot frame's shader compiles.
  for (const times of Object.values(frameTimes)) times.length = 0;
  window.__hd2d = {
    ready: true,
    frame,
    hash,
    info: () => ({
      renderer: rendererName,
      mounted: enabled.map(([name]) => name),
      frameMs: frameStats(),
      scene: facadeHooks?.scene(),
    }),
    applyScene: facadeHooks && ((json) => facadeHooks!.hd2d.applyScene(parseHd2dScene(json))),
  };
}

void start();
