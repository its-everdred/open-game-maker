import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { env, execArgv, execPath } from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from '@playwright/test';

const capabilities = ['lighting', 'focus', 'particles'];
const { values } = parseArgs({
  options: {
    renderer: { type: 'string', default: 'three' },
    toggles: { type: 'string', default: '' },
    quality: { type: 'string', default: 'high' },
    facade: { type: 'boolean', default: false },
    seconds: { type: 'string', default: '6' },
    out: { type: 'string', default: 'artifacts/hd2d' },
  },
});
const renderer = values.renderer;
if (renderer !== 'three' && renderer !== 'phaser') throw new Error('--renderer must be three or phaser');
const quality = values.quality;
if (quality !== 'high' && quality !== 'low') throw new Error('--quality must be high or low');
const seconds = Number(values.seconds);
if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('--seconds must be positive');
const toggles = values.toggles.split(',').filter(Boolean);
if (values.facade && toggles.length !== capabilities.length)
  throw new Error('--facade composes all three: add --toggles lighting,focus,particles');
const unknown = toggles.filter((name) => !capabilities.includes(name));
if (unknown.length) throw new Error(`unknown --toggles ${unknown.join(',')}; use ${capabilities.join(',')}`);
const output = resolve(values.out);
const frames = Math.round(seconds * 60);
const port = env.SDK_AUDIO_TEST_PORT ?? '4182';
const origin = `http://127.0.0.1:${port}`;
const url = `${origin}/hd2d/?renderer=${renderer}&quality=${quality}&seed=1${toggles.map((name) => `&${name}=1`).join('')}${
  values.facade ? '&facade=1' : ''
}`;
let browser: Browser | undefined;

await import('./build.js'); // capture what the source says now, never a stale bundle
// Run the server under this same tsx-loaded node, so kill() stops the server itself.
const server = spawn(
  execPath,
  [...execArgv, fileURLToPath(new URL('../../audio/fixture/server.ts', import.meta.url))],
  {
    stdio: 'ignore',
    env: { ...env, SDK_AUDIO_TEST_PORT: port },
  },
);

function command(name: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(name, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolvePromise(stdout) : reject(new Error(`${name} exited ${code}: ${stderr}`)),
    );
  });
}

try {
  for (let attempt = 0; ; attempt += 1) {
    const up = await fetch(`${origin}/health`)
      .then((response) => response.ok)
      .catch(() => false);
    if (up) break;
    if (attempt > 50) throw new Error(`fixture server did not start on ${origin}`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  await rm(`${output}/frames`, { recursive: true, force: true });
  await mkdir(`${output}/frames`, { recursive: true });
  browser = await chromium.launch({ args: ['--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
  await page.goto(url);
  await page.waitForFunction(() => window.__hd2d?.ready);
  const mounted = await page.evaluate(() => window.__hd2d!.info().mounted);
  if (mounted.join() !== capabilities.filter((name) => toggles.includes(name)).join())
    throw new Error(`fixture mounted [${mounted.join()}], expected [${toggles.join()}]`);
  for (let index = 0; index < frames; index += 1) {
    await page.evaluate((time) => window.__hd2d!.frame(time), (index * 1000) / 60);
    await page.screenshot({ path: `${output}/frames/frame-${String(index).padStart(5, '0')}.png` });
  }
  const still = `${output}/${renderer}.png`;
  await copyFile(`${output}/frames/frame-00000.png`, still);
  const video = `${output}/${renderer}.mp4`;
  await command('ffmpeg', [
    '-y',
    '-framerate',
    '60',
    '-i',
    `${output}/frames/frame-%05d.png`,
    '-frames:v',
    String(frames),
    '-an',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-r',
    '60',
    video,
  ]);
  const metadata = JSON.parse(
    await command('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=avg_frame_rate,nb_frames,duration',
      '-of',
      'json',
      video,
    ]),
  ) as { streams: Array<{ avg_frame_rate: string; nb_frames: string; duration: string }> };
  const stream = metadata.streams[0];
  if (
    !stream ||
    stream.avg_frame_rate !== '60/1' ||
    Number(stream.nb_frames) !== frames ||
    Math.abs(Number(stream.duration) - seconds) > 0.02
  ) {
    throw new Error(`capture validation failed: ${JSON.stringify(stream)}`);
  }
  const firstFrame = createHash('sha256')
    .update(await readFile(still))
    .digest('hex');
  console.log(
    `Wrote ${video} (${stream.nb_frames} frames, ${stream.duration}s) and ${still}; first frame sha256 ${firstFrame}`,
  );
} finally {
  await browser?.close();
  server.kill();
}
