import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { env } from 'node:process';
import { chromium, type Browser } from '@playwright/test';

const { values } = parseArgs({
  options: {
    renderer: { type: 'string', default: 'three' },
    toggles: { type: 'string', default: '' },
    seconds: { type: 'string', default: '6' },
    out: { type: 'string', default: 'artifacts/hd2d' },
  },
});
if (values.renderer !== 'three' && values.renderer !== 'phaser') throw new Error('--renderer must be three or phaser');
const seconds = Number(values.seconds);
if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('--seconds must be positive');
const output = resolve(values.out);
const frames = Math.round(seconds * 60);
const toggles = values.toggles
  .split(',')
  .filter(Boolean)
  .map((value) => `${value}=1`)
  .join('&');
const port = env.SDK_AUDIO_TEST_PORT ?? '4182';
const origin = `http://127.0.0.1:${port}`;
const url = `${origin}/hd2d/?renderer=${values.renderer}&quality=high&seed=1${toggles ? `&${toggles}` : ''}`;
let browser: Browser | undefined;
// Serves dist/hd2d-fixture; run `tsx src/hd2d/fixture/build.ts` first.
const server = spawn('tsx', ['src/audio/fixture/server.ts'], {
  stdio: 'ignore',
  env: { ...env, SDK_AUDIO_TEST_PORT: port },
});

function command(name: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const process = spawn(name, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    process.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    process.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    process.on('error', reject);
    process.on('close', (code) =>
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
  await mkdir(output, { recursive: true });
  await mkdir(`${output}/frames`, { recursive: true });
  browser = await chromium.launch({ args: ['--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
  await page.goto(url);
  await page.waitForFunction(() => window.__hd2d?.ready);
  for (let index = 0; index < frames; index += 1) {
    await page.evaluate((time) => window.__hd2d!.frame(time), (index * 1000) / 60);
    await page.screenshot({ path: `${output}/frames/frame-${String(index).padStart(5, '0')}.png` });
  }
  const renderer = values.renderer;
  await writeFile(`${output}/still.png`, await readFile(`${output}/frames/frame-00000.png`));
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
  console.log(`Wrote ${video} (${stream.nb_frames} frames, ${stream.duration}s) and ${output}/still.png`);
} finally {
  await browser?.close();
  server.kill();
}
