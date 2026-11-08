import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { launch } from '../src/browser.js';
import { hasFfmpeg } from '../src/capture.js';
import { driveJourney } from '../src/qa/drive.js';
import { roomJourneySchema, soloJourneySchema } from '../src/qa/journey.js';
import { qaOpen } from '../src/qa/open.js';
import { qaRoom } from '../src/qa/room.js';
import { serveQaGame } from './qa-fixture-server.js';

/* CI sets GM_VERIFY_SOFTWARE_GL=1 (no GPU on the runner). */
const SOFTWARE = process.env.GM_VERIFY_SOFTWARE_GL === '1';
const FFMPEG = hasFfmpeg();
const out = () => mkdtempSync(join(tmpdir(), 'gm-qa-'));

let server: Awaited<ReturnType<typeof serveQaGame>>;
let browser: Browser;
beforeAll(async () => {
  server = await serveQaGame();
  browser = await launch(SOFTWARE);
});
afterAll(async () => {
  await browser.close();
  await server.close();
});

describe('gm qa open', () => {
  it('boots a hook-less build on phone and desktop and times it to the first non-blank frame', async () => {
    const dir = out();
    const result = await qaOpen(browser, server.url, { outDir: dir, timeoutMs: 10_000 });
    expect(result.verdict).toBe('pass');
    expect(result.viewports.map((v) => v.viewport)).toEqual(['phone', 'desktop']);
    for (const v of result.viewports) {
      expect(v.readyHook).toBe(false);
      expect(v.ttiMs).not.toBeNull();
      expect(v.blank).toBe(false);
      expect(existsSync(join(dir, v.still))).toBe(true);
    }
    expect(existsSync(join(dir, 'qa-open.json'))).toBe(true);
  });

  it('fails a build that only ever shows one flat colour', async () => {
    const result = await qaOpen(browser, `${server.url}?blank`, {
      outDir: out(),
      viewports: ['desktop'],
      timeoutMs: 1_500,
    });
    expect(result.verdict).toBe('fail');
    expect(result.viewports[0]?.failures).toContain('blank frame');
    expect(result.viewports[0]?.ttiMs).toBeNull();
  });

  it('fails a build that logs a console error while booting', async () => {
    const result = await qaOpen(browser, `${server.url}?noisy`, {
      outDir: out(),
      viewports: ['phone'],
      timeoutMs: 5_000,
    });
    expect(result.verdict).toBe('fail');
    expect(result.viewports[0]?.failures).toContain('console error: qa stub noise');
  });

  it('fails a build the games host answers with a 502, whatever the error page paints', async () => {
    const result = await qaOpen(browser, `${server.url}down/`, {
      outDir: out(),
      viewports: ['desktop'],
      timeoutMs: 2_000,
    });
    expect(result.verdict).toBe('fail');
    expect(result.viewports[0]?.failures).toContain(`HTTP 502 from ${server.url}down/`);
  });
});

describe('gm qa drive', () => {
  it('plays a desktop journey with the keyboard, waits on text and pixels, and records a clip', async () => {
    const dir = out();
    const journey = soloJourneySchema.parse({
      name: 'keys',
      viewport: 'desktop',
      steps: [
        { do: 'click', text: 'Play' },
        { do: 'expect', text: 'Score 0' },
        { do: 'press', key: 'ArrowRight', times: 3 },
        {
          do: 'expect',
          text: 'Score 3',
          pixels: 'changed',
          region: [0, 0.25, 1, 0.5],
          look: 'Has the square moved right?',
        },
        { do: 'shot', name: 'moved' },
      ],
    });
    const result = await driveJourney(browser, server.url, journey, { outDir: dir });
    expect(result.steps.map((s) => s.error ?? 'ok')).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
    expect(result.verdict).toBe('pass');
    expect(result.steps[3]?.look).toBe('Has the square moved right?');
    expect(existsSync(join(dir, 'keys', result.steps[3]!.shot!))).toBe(true);
    expect(existsSync(join(dir, 'keys', 'journey-result.json'))).toBe(true);
    if (FFMPEG) {
      expect(result.clip).toEqual({ mp4: 'journey.mp4', gif: 'journey.gif' });
      expect(existsSync(join(dir, 'keys', 'journey.mp4'))).toBe(true);
      expect(existsSync(join(dir, 'keys', 'journey.gif'))).toBe(true);
    } else expect(result.unchecked[0]).toMatch(/^clip/);
  });

  it('drives a phone with touch: taps a button and swipes the board through CDP touch events', async () => {
    const journey = soloJourneySchema.parse({
      name: 'touch',
      viewport: 'phone',
      steps: [
        { do: 'tap', text: 'Play' },
        { do: 'swipe', from: [0.2, 0.5], to: [0.8, 0.5] },
        { do: 'expect', text: 'Score 1', timeoutMs: 3_000 },
      ],
    });
    const result = await driveJourney(browser, server.url, journey, { outDir: out(), ffmpegBinary: 'no-such-ffmpeg' });
    expect(result.steps.map((s) => s.error ?? 'ok')).toEqual(['ok', 'ok', 'ok']);
    expect(result.viewport).toBe('phone');
    expect(result.unchecked).toEqual(['clip (no-such-ffmpeg not found on PATH)']);
  });

  it('fails the journey on a missing expect and does not run the steps after it', async () => {
    const journey = soloJourneySchema.parse({
      name: 'missing',
      steps: [
        { do: 'click', text: 'Play' },
        { do: 'expect', text: 'Score 99', timeoutMs: 500 },
        { do: 'press', key: 'ArrowRight' },
      ],
    });
    const result = await driveJourney(browser, server.url, journey, { outDir: out(), ffmpegBinary: 'no-such-ffmpeg' });
    expect(result.verdict).toBe('fail');
    expect(result.steps[1]?.error).toBe('missing text "Score 99" after 500ms');
    expect(result.steps[1]?.shot).toMatch(/fail-1\.png$/);
    expect(result.skipped).toBe(1);
  });

  it('fails at the first step when the build answers 502, rather than playing the error page', async () => {
    const journey = soloJourneySchema.parse({ name: 'down', steps: [{ do: 'click', text: 'Play' }] });
    const dir = out();
    const result = await driveJourney(browser, `${server.url}down/`, journey, {
      outDir: dir,
      ffmpegBinary: 'no-such-ffmpeg',
    });
    expect(result.verdict).toBe('fail');
    expect(result.steps).toEqual([expect.objectContaining({ ok: false, error: `HTTP 502 from ${server.url}down/` })]);
    expect(existsSync(join(dir, 'down', 'journey-result.json'))).toBe(true);
  });
});

describe('gm qa room', () => {
  const room = (overrides: Record<string, unknown> = {}) =>
    roomJourneySchema.parse({
      name: 'room',
      kind: 'room',
      host: [
        { do: 'click', text: 'Create room' },
        { do: 'expect', text: 'players' },
        { do: 'read', as: 'link', url: true },
      ],
      join: [{ do: 'goto', url: '{link}' }],
      seated: { do: 'expect', text: '{clients} players' },
      start: [{ do: 'click', text: 'Start' }],
      countdown: { do: 'expect', text: 'Starting' },
      move: {
        steps: [{ do: 'press', key: 'ArrowRight', times: 2 }],
        expect: { do: 'expect', pixels: 'changed', region: [0, 0.25, 1, 0.5], timeoutMs: 3_000 },
      },
      rejoin: { do: 'expect', text: '{clients} players' },
      dropMs: 1_000,
      ...overrides,
    });

  it(
    'seats three mixed phone and desktop clients, syncs the countdown, shares a move and survives a drop',
    { timeout: 400_000 },
    async () => {
      const dir = out();
      const result = await qaRoom(browser, server.url, room(), { outDir: dir, clients: 3 });
      expect(result.checks.map((c) => `${c.name}:${c.ok ? 'ok' : c.detail}`)).toEqual([
        'host:ok',
        'join:ok',
        'seated:ok',
        'start:ok',
        'countdown:ok',
        'move:ok',
        'rejoin:ok',
      ]);
      expect(result.verdict).toBe('pass');
      expect(result.clients.map((c) => c.viewport)).toEqual(['desktop', 'phone', 'desktop']);
      expect(result.checks.find((c) => c.name === 'countdown')?.detail).toMatch(
        /^countdown spread \d+ms \(limit 500ms\)$/,
      );
      if (FFMPEG) {
        expect(result.tile).toBe('room.png');
        expect(result.clip).toEqual({ mp4: 'room.mp4', gif: 'room.gif' });
        expect(existsSync(join(dir, 'room', 'room.mp4'))).toBe(true);
      }
    },
  );

  it('fails the move check when the other clients never see the host move', { timeout: 400_000 }, async () => {
    const result = await qaRoom(
      browser,
      server.url,
      room({
        move: {
          steps: [{ do: 'wait', ms: 50 }],
          expect: { do: 'expect', pixels: 'changed', region: [0, 0.25, 1, 0.5], timeoutMs: 800 },
        },
      }),
      { outDir: out(), clients: 2, ffmpegBinary: 'no-such-ffmpeg' },
    );
    expect(result.verdict).toBe('fail');
    expect(result.checks.find((c) => c.name === 'move')?.detail).toBe(
      'seat 1: expect pixels changed: missing changed pixels after 800ms',
    );
    expect(result.checks.some((c) => c.name === 'rejoin')).toBe(false);
  });
});
