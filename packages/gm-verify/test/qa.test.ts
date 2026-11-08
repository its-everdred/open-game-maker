import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { DriveResult } from '../src/qa/drive.js';
import { fill, journeySchema, roomJourneySchema } from '../src/qa/journey.js';
import { groupRequests, MAX_LOOK_IMAGES, writeLookRequests, writeQaReport, type LookQuestion } from '../src/qa/look.js';
import { clipStart, gifArgs, mp4Args, recordSize, sideBySideArgs } from '../src/qa/media.js';
import { countdownSpread, viewportFor, type QaRoomResult } from '../src/qa/room.js';

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

  it('starts a clip a second before the first input, not on the minute of asset loading before it', () => {
    expect(clipStart(10_000, 70_500)).toBe(59.5);
    expect(clipStart(10_000, 10_400)).toBe(0);
    expect(clipStart(10_000, undefined)).toBe(0);
    expect(mp4Args('in.webm', 'out.mp4', 59.5).slice(0, 4)).toEqual(['-ss', '59.50', '-i', 'in.webm']);
    expect(mp4Args('in.webm', 'out.mp4')[0]).toBe('-i');
  });

  it('keeps the GIF to a 15 s preview so a long journey cannot stall the encode', () => {
    expect(gifArgs('in.mp4', 'out.gif').slice(0, 4)).toEqual(['-t', '15', '-i', 'in.mp4']);
  });

  it('seeks each stacked recording to its own start so the panes show one moment', () => {
    expect(sideBySideArgs(['a.webm', 'b.webm'], 'o.mp4', true, [2, 0.5]).slice(0, 6)).toEqual([
      '-ss',
      '2.00',
      '-i',
      'a.webm',
      '-ss',
      '0.50',
    ]);
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

function runDir(unchecked = ['clip (ffmpeg not found on PATH)']): string {
  const dir = mkdtempSync(join(tmpdir(), 'gm-qa-look-'));
  mkdirSync(join(dir, 'solo-cpu'));
  writeFileSync(join(dir, 'solo-cpu', 'desktop-01-look-1.png'), 'board');
  writeFileSync(join(dir, 'solo-cpu', 'desktop-02-end.png'), 'end');
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
    unchecked,
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
    expect(requests[0]?.questions.map(({ hash: _hash, ...q }) => q)).toEqual([
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
    const dir = runDir([]);
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

  it('stays unchecked while a clip is missing, even with every look answered yes', () => {
    const dir = runDir();
    const { answersPath } = writeLookRequests(dir, rules);
    writeFileSync(answersPath, JSON.stringify({ 'solo-cpu#1': { pass: true }, 'solo-cpu#rule1': { pass: true } }));
    expect(writeQaReport(dir, rules).verdict).toBe('unchecked');
  });

  it('drops an answer once its still changes, so a rerun cannot inherit an old yes', () => {
    const dir = runDir([]);
    const { answersPath } = writeLookRequests(dir, rules);
    writeFileSync(answersPath, JSON.stringify({ 'solo-cpu#1': { pass: true }, 'solo-cpu#rule1': { pass: true } }));
    writeFileSync(join(dir, 'solo-cpu', 'desktop-01-look-1.png'), 'a different board');
    const report = writeQaReport(dir, rules);
    expect(report.verdict).toBe('unchecked');
    expect(readFileSync(report.path, 'utf8')).toContain('changed since gm qa look');
    writeLookRequests(dir, rules);
    expect(JSON.parse(readFileSync(answersPath, 'utf8'))).toEqual({
      'solo-cpu#1': null,
      'solo-cpu#rule1': { pass: true, note: '' },
    });
  });

  it('fails a journey that logged a console error while it played', () => {
    const dir = runDir([]);
    const path = join(dir, 'solo-cpu', 'journey-result.json');
    const result = JSON.parse(readFileSync(path, 'utf8')) as DriveResult;
    result.console = [{ level: 'error', text: 'TypeError: board is undefined' }];
    writeFileSync(path, JSON.stringify(result));
    const report = writeQaReport(dir, []);
    expect(report.verdict).toBe('fail');
    expect(readFileSync(report.path, 'utf8')).toContain('| console errors | fail | 1: TypeError: board is undefined |');
  });

  it('fails a room that crashed after hosting, listing every check it never reached', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gm-qa-room-'));
    mkdirSync(join(dir, 'online-2p'));
    const room: QaRoomResult = {
      journey: 'online-2p',
      url: 'https://games.example/g/1/2/',
      clients: [
        { seat: 0, viewport: 'desktop', console: [] },
        { seat: 1, viewport: 'phone', console: [] },
      ],
      checks: [{ name: 'host', ok: true, detail: '', steps: [] }],
      verdict: 'fail',
      tile: null,
      clip: null,
      unchecked: [],
      error: 'Target page, context or browser has been closed',
    };
    writeFileSync(join(dir, 'online-2p', 'qa-room.json'), JSON.stringify(room));
    const report = writeQaReport(dir, []);
    expect(report.verdict).toBe('fail');
    const md = readFileSync(report.path, 'utf8');
    expect(md).toContain('| run | fail | Target page, context or browser has been closed |');
    for (const name of ['join', 'seated', 'countdown', 'move', 'rejoin'])
      expect(md).toContain(`| ${name} | fail | not reached |`);
    expect(md).not.toContain('| host | fail |');
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
