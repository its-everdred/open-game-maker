import { writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from '../../apps/web/node_modules/playwright/index.mjs';

const execFileAsync = promisify(execFile);
const base = process.env.PROTOTYPE_URL ?? 'http://127.0.0.1:8000/prototypes/hd2d-lighting/';
const outDir = new URL('./', import.meta.url);
async function renderDeterministicFrame(page, seconds) {
  await page.evaluate(time => {
    const canvas = document.querySelector('canvas');
    const context = canvas.getContext('2d');
    const pixels = () => context.getImageData(0, 0, canvas.width, canvas.height).data;
    window.__frame(time);
    const expected = pixels();
    window.__frame(0);
    const initial = pixels();
    window.__frame(time);
    const actual = pixels();
    let unstable = 0, changed = 0;
    for (let i = 0; i < expected.length; i += 4) {
      const repeatDiff = Math.max(Math.abs(expected[i] - actual[i]), Math.abs(expected[i + 1] - actual[i + 1]), Math.abs(expected[i + 2] - actual[i + 2]));
      const motionDiff = Math.max(Math.abs(expected[i] - initial[i]), Math.abs(expected[i + 1] - initial[i + 1]), Math.abs(expected[i + 2] - initial[i + 2]));
      if (repeatDiff > 8) unstable++;
      if (motionDiff > 8) changed++;
    }
    if (unstable > 64) throw new Error(`Frame at ${time}s is not repeatable (${unstable} pixels differ by more than 8/255)`);
    if (changed < 16) throw new Error(`Frame at ${time}s shows no visible animation`);
  }, seconds);
}
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  headless: true,
  args: ['--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'],
});

try {
  for (const name of ['sprite-lighting', 'canopy-shafts']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await page.goto(`${base}${name}.html?capture`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await renderDeterministicFrame(page, 2.4);
    await page.screenshot({ path: new URL(`${name}-desktop.png`, outDir).pathname });

    await page.close();
    const phone = await browser.newPage({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
    });
    await phone.goto(`${base}${name}.html?capture`, { waitUntil: 'load' });
    await phone.evaluate(() => document.fonts.ready);
    await renderDeterministicFrame(phone, 2.4);
    await phone.screenshot({ path: new URL(`${name}-phone.png`, outDir).pathname });
    await phone.close();

    const recordingPage = await browser.newPage({ viewport: { width: 960, height: 700 } });
    await recordingPage.goto(`${base}${name}.html?capture`, { waitUntil: 'load' });

    const webm = await recordingPage.evaluate(async () => {
      const canvas = document.querySelector('canvas');
      const stream = canvas.captureStream(30);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
      const chunks = [];
      const samples = [];
      let nextSample = 1;
      const frameHash = () => {
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let hash = 2166136261;
        for (const pixel of pixels) hash = Math.imul(hash ^ pixel, 16777619);
        return hash >>> 0;
      };
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      const stopped = new Promise(resolve => { recorder.onstop = resolve; });
      recorder.start();
      const start = performance.now();
      const animate = now => {
        const seconds = (now - start) / 1000;
        window.__frame(seconds);
        if (seconds >= nextSample) {
          samples.push(frameHash());
          nextSample++;
        }
        if (seconds < 6) requestAnimationFrame(animate);
        else recorder.stop();
      };
      requestAnimationFrame(animate);
      await stopped;
      stream.getTracks().forEach(track => track.stop());
      const blob = new Blob(chunks, { type: 'video/webm' });
      if (blob.size < 1024 || new Set(samples).size < 2) throw new Error('Recording is empty or its canvas does not animate');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(binary);
    });
    const webmPath = new URL(`${name}.webm`, outDir).pathname;
    await writeFile(webmPath, Buffer.from(webm, 'base64'));
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error', '-count_frames', '-select_streams', 'v:0',
      '-show_entries', 'stream=nb_read_frames:format=duration', '-of', 'json', webmPath,
    ]);
    const probe = JSON.parse(stdout);
    const duration = Number(probe.format?.duration);
    const frames = Number(probe.streams?.[0]?.nb_read_frames);
    if (!Number.isFinite(duration) || !Number.isInteger(frames) || duration < 5 || duration > 10 || frames < 150) {
      throw new Error(`${name} recording is ${duration}s and ${frames} frames; expected 5–10s at about 30 fps`);
    }
    const { stdout: frameHashes } = await execFileAsync('ffmpeg', ['-v', 'error', '-i', webmPath, '-vf', 'fps=1', '-f', 'framemd5', '-']);
    const decodedHashes = frameHashes.split('\n').filter(line => line && !line.startsWith('#')).map(line => line.split(',').at(-1).trim());
    if (new Set(decodedHashes).size < 2) throw new Error(`${name} recording decodes to frozen video`);
    await recordingPage.close();
  }
} finally {
  await browser.close();
}
