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
      // Dictation ends by stopping its tracks; the voice session's capture that follows must still hear the next clip.
      for (const track of stream.getTracks()) track.stop();
      const again = await navigator.mediaDevices.getUserMedia({ audio: true });
      const second = context.createAnalyser();
      context.createMediaStreamSource(again).connect(second);
      const samples2 = new Float32Array(second.fftSize);
      await mic.play('talk');
      let after = 0;
      for (let i = 0; i < 60; i++) {
        second.getFloatTimeDomainData(samples2);
        for (const sample of samples2) after = Math.max(after, Math.abs(sample));
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const micOnly = (window as unknown as { __ogmFakeMic: { playedSeconds: number } }).__ogmFakeMic.playedSeconds;
      // The client's one-sample audio unlock is not a reply.
      const unlock = context.createBufferSource();
      unlock.buffer = context.createBuffer(1, 1, 24_000);
      unlock.start();
      // The page's own playback (the agent's reply) counts; the fake microphone's clips do not.
      const reply = context.createBufferSource();
      reply.buffer = context.createBuffer(1, 24_000, 24_000);
      reply.connect(context.destination);
      reply.start();
      const withReply = (window as unknown as { __ogmFakeMic: { playedSeconds: number } }).__ogmFakeMic.playedSeconds;
      return { silent, speaking, after, micOnly, withReply, requested: mic.requested };
    });
    expect(levels.requested).toBe(2);
    expect(levels.silent).toBeLessThan(0.001);
    expect(levels.speaking).toBeGreaterThan(0.05);
    expect(levels.after).toBeGreaterThan(0.05);
    expect(levels.micOnly).toBe(0);
    expect(levels.withReply).toBeCloseTo(1, 5);
  } finally {
    await context.close();
  }
});

it("refuses the microphone under Safari's playback audio session, as an iPhone does", async () => {
  const context = await browser.newContext();
  try {
    await context.addInitScript(installFakeMic, {});
    const page = await context.newPage();
    await page.route('https://mic.test/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }),
    );
    await page.goto('https://mic.test/');
    const outcomes = await page.evaluate(async () => {
      const session = (navigator as Navigator & { audioSession: { type: string } }).audioSession;
      const open = () =>
        navigator.mediaDevices.getUserMedia({ audio: true }).then(
          () => 'open',
          (error: DOMException) => error.name,
        );
      session.type = 'playback';
      const playback = await open();
      session.type = 'play-and-record';
      return { playback, recording: await open() };
    });
    // Chromium has no audio session, so without this the post-deploy voice check passed while iPhones failed (#1325).
    expect(outcomes).toEqual({ playback: 'InvalidStateError', recording: 'open' });
  } finally {
    await context.close();
  }
});
