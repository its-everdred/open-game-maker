import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { CLIPS, installFakeMic } from '../src/qa-voice-e2e.js';

type Browser = Awaited<ReturnType<(typeof import('@ogm/gm-verify'))['launch']>>;

// The prod voice E2E (#879) speaks through a fake microphone. The app reads it with getUserMedia and an AudioContext,
// as on a phone, so this reads it the same way: silence until the run plays a clip, then the clip's speech.
const MEDIA = new URL('../qa/voice-e2e/', import.meta.url);

let browser: Browser;
beforeAll(async () => {
  const { launch } = await import('@ogm/gm-verify');
  browser = await launch(true);
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

it('feeds the recorded clip, and only the clip, into the page microphone', async () => {
  const clips = Object.fromEntries(
    Object.entries(CLIPS).map(([name, file]) => [name, readFileSync(new URL(file, MEDIA)).toString('base64')]),
  );
  const context = await browser.newContext();
  try {
    await context.addInitScript(installFakeMic, clips);
    const page = await context.newPage();
    // A secure origin, as the deployed app is: navigator.mediaDevices exists only there.
    await page.route('https://mic.test/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }),
    );
    await page.goto('https://mic.test/');
    const levels = await page.evaluate(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true } });
      const context = new AudioContext();
      await context.resume();
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const peak = async (ms: number) => {
        let max = 0;
        const end = performance.now() + ms;
        while (performance.now() < end) {
          analyser.getFloatTimeDomainData(samples);
          for (const sample of samples) max = Math.max(max, Math.abs(sample));
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        return max;
      };
      const mic = (window as unknown as { __ogmFakeMic: { requested: number; play(n: string): Promise<void> } })
        .__ogmFakeMic;
      const silent = await peak(300);
      await mic.play('dictate');
      const speaking = await peak(1_200);
      return { silent, speaking, requested: mic.requested };
    });
    expect(levels.requested).toBe(1);
    expect(levels.silent).toBeLessThan(0.001);
    expect(levels.speaking).toBeGreaterThan(0.05);
  } finally {
    await context.close();
  }
});
