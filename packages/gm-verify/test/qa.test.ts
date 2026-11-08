import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { DriveResult } from '../src/qa/drive.js';
import { fill, journeySchema, roomJourneySchema } from '../src/qa/journey.js';
import { groupRequests, MAX_LOOK_IMAGES, writeLookRequests, writeQaReport, type LookQuestion } from '../src/qa/look.js';
import { recordSize, sideBySideArgs } from '../src/qa/media.js';
import { countdownSpread, viewportFor } from '../src/qa/room.js';

describe('journey schema', () => {
  it('refuses a click that names nothing to click, so a typo cannot pass as a no-op', () => {
    expect(() => journeySchema.parse({ name: 'x', steps: [{ do: 'click' }] })).toThrow(/click needs text or selector/);
  });

  it('refuses an expect that checks nothing, so a journey cannot pass without asserting', () => {
    expect(() => journeySchema.parse({ name: 'x', steps: [{ do: 'expect' }] })).toThrow(
      /expect needs text, pixels or look/,
    );
  });

  it('reads a room journey as a room and fills its defaults', () => {
    const journey = journeySchema.parse({
      name: 'online',
      kind: 'room',
      host: [{ do: 'click', text: 'Online' }],
      join: [{ do: 'goto', url: '{link}' }],
      seated: { do: 'expect', text: '{clients} players' },
      countdown: { do: 'expect', text: '3' },
      move: { steps: [{ do: 'press', key: 'ArrowLeft' }], expect: { do: 'expect', pixels: 'changed' } },
      rejoin: { do: 'expect', text: 'Back' },
    });
    expect(journey.kind).toBe('room');
    expect(roomJourneySchema.parse(journey)).toMatchObject({ countdownSpreadMs: 500, dropMs: 3_000, start: [] });
  });

  it('fills variables and refuses an unknown one instead of typing "{code}" into the game', () => {
    expect(fill('join {code} as {seat}', { code: 'AB12', seat: '1' })).toBe('join AB12 as 1');
    expect(() => fill('{code}', {})).toThrow('no value for {code}');
  });
});

describe('room checks', () => {
  it('passes a countdown every client saw within the spread and fails one that drifted or never came', () => {
    expect(countdownSpread([1_000, 1_200, 1_400], 500)).toEqual({
      ok: true,
      detail: 'countdown spread 400ms (limit 500ms)',
    });
    expect(countdownSpread([1_000, 1_700], 500).ok).toBe(false);
    expect(countdownSpread([1_000, undefined], 500)).toEqual({ ok: false, detail: 'a client never saw the countdown' });
  });

  it('mixes phone and desktop with the host on a desktop', () => {
    expect([0, 1, 2, 3].map(viewportFor)).toEqual(['desktop', 'phone', 'desktop', 'phone']);
  });

  it('records a desktop at 960 px wide and a phone at its own size', () => {
    expect(recordSize({ width: 1440, height: 900 })).toEqual({ width: 960, height: 600 });
    expect(recordSize({ width: 390, height: 844 })).toEqual({ width: 390, height: 844 });
  });

  it('scales every pane to one height before stacking so a phone and a desktop line up', () => {
    const args = sideBySideArgs(['a.webm', 'b.webm'], 'out.mp4', true);
    expect(args.join(' ')).toContain('[0:v]scale=-2:720[p0];[1:v]scale=-2:720[p1];[p0][p1]hstack=inputs=2:shortest=1');
    expect(sideBySideArgs(['a.png'], 'out.png', false)).toContain('-frames:v');
  });
});

describe('look requests', () => {
  const question = (image: string, id = image): LookQuestion => ({ id, image, text: 'ok?' });

  it(`never puts more than ${MAX_LOOK_IMAGES} images in one request and keeps an image's questions together`, () => {
    const questions = [...Array.from({ length: 8 }, (_, i) => question(`i${i}.png`)), question('i7.png', 'again')];
    const requests = groupRequests(questions);
    expect(requests.map((r) => r.images.length)).toEqual([6, 2]);
    expect(requests[1]?.questions.map((q) => q.id)).toEqual(['i6.png', 'i7.png', 'again']);
  });
});

function runDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gm-qa-look-'));
  mkdirSync(join(dir, 'solo-cpu'));
  const result: DriveResult = {
    journey: 'solo-cpu',
    url: 'https://games.example/g/1/2/',
    viewport: 'desktop',
    verdict: 'pass',
    steps: [
      { index: 0, step: 'click "Solo"', ok: true, ms: 10 },
      {
        index: 1,
        step: 'expect text "GO"',
        ok: true,
        ms: 10,
        look: 'Is the board drawn?',
        shot: 'desktop-01-look-1.png',
      },
      { index: 2, step: 'shot end', ok: true, ms: 10, shot: 'desktop-02-end.png' },
    ],
    skipped: 0,
    console: [],
    clip: null,
    unchecked: ['clip (ffmpeg not found on PATH)'],
  };
  writeFileSync(join(dir, 'solo-cpu', 'journey-result.json'), JSON.stringify(result));
  return dir;
}

describe('qa report', () => {
  const rules = ['Characters are rigged KayKit models, never stand-ins.'];

  it('asks the journey looks and each creator rule of the last still, then reports them unchecked until answered', () => {
    const dir = runDir();
    const { requests, answersPath } = writeLookRequests(dir, rules);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.questions).toEqual([
      { id: 'solo-cpu#1', image: 'solo-cpu/desktop-01-look-1.png', text: 'Is the board drawn?' },
      {
        id: 'solo-cpu#rule1',
        image: 'solo-cpu/desktop-02-end.png',
        text: 'Does this keep the creator\'s rule: "Characters are rigged KayKit models, never stand-ins."?',
      },
    ]);
    expect(JSON.parse(readFileSync(answersPath, 'utf8'))).toEqual({ 'solo-cpu#1': null, 'solo-cpu#rule1': null });

    const report = writeQaReport(dir, rules);
    expect(report.verdict).toBe('unchecked');
    const md = readFileSync(report.path, 'utf8');
    expect(md).toContain('| click "Solo" | pass |');
    expect(md).toContain('| look: Is the board drawn? | unchecked |');
    expect(md).toContain('Unchecked: solo-cpu: clip (ffmpeg not found on PATH)');
  });

  it('passes only when every step passed and every look was answered yes, and fails on one no', () => {
    const dir = runDir();
    const { answersPath } = writeLookRequests(dir, rules);
    writeFileSync(answersPath, JSON.stringify({ 'solo-cpu#1': { pass: true }, 'solo-cpu#rule1': { pass: true } }));
    expect(writeQaReport(dir, rules).verdict).toBe('pass');
    writeFileSync(
      answersPath,
      JSON.stringify({ 'solo-cpu#1': { pass: true }, 'solo-cpu#rule1': { pass: false, note: 'grey capsules' } }),
    );
    const report = writeQaReport(dir, rules);
    expect(report.verdict).toBe('fail');
    expect(readFileSync(report.path, 'utf8')).toContain('| fail | grey capsules (solo-cpu/desktop-02-end.png) |');
  });

  it('keeps earlier answers when the requests are written again', () => {
    const dir = runDir();
    const { answersPath } = writeLookRequests(dir, rules);
    writeFileSync(answersPath, JSON.stringify({ 'solo-cpu#1': { pass: true, note: '' }, 'solo-cpu#rule1': null }));
    writeLookRequests(dir, rules);
    expect(JSON.parse(readFileSync(answersPath, 'utf8'))['solo-cpu#1']).toEqual({ pass: true, note: '' });
  });

  it('fails a journey whose step failed even with no looks', () => {
    const dir = runDir();
    const path = join(dir, 'solo-cpu', 'journey-result.json');
    const result = JSON.parse(readFileSync(path, 'utf8')) as DriveResult;
    result.steps[1] = { ...result.steps[1]!, ok: false, error: 'missing text "GO" after 10000ms' };
    result.skipped = 1;
    writeFileSync(path, JSON.stringify(result));
    const report = writeQaReport(dir, []);
    expect(report.verdict).toBe('fail');
    expect(readFileSync(report.path, 'utf8')).toContain('| 1 later steps | fail | not run after the failure |');
  });
});
