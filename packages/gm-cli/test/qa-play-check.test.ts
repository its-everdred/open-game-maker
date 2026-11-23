import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import {
  changedShare,
  firstTapPath,
  frameStddev,
  gameApiAnswer,
  judgePlay,
  moveKey,
  type PlayObservation,
  type PlayTraceEntry,
} from '../src/qa-play-check.js';

const booted: PlayTraceEntry[] = [
  { ms: 900, dir: 'window', t: 'hello', n: 1 },
  { ms: 950, dir: 'in', t: 'ready', n: 1 },
  { ms: 1_200, dir: 'in', t: 'load.progress', n: 12 },
  { ms: 4_000, dir: 'in', t: 'load.frame', n: 1 },
  { ms: 5_000, dir: 'in', t: 'load.done', n: 1 },
];

/** A game that booted, took its tap path and moved its player. */
function played(overrides: Partial<PlayObservation> = {}): PlayObservation {
  return {
    bridgeState: 'ready',
    trace: booted,
    bootMs: 4_100,
    tryAgain: false,
    tapPath: ['Play', 'Continue', 'Start'],
    frameStddev: 18,
    idleChange: 0.001,
    inputChange: 0.22,
    input: 'stick',
    ...overrides,
  };
}

describe('qa play-check verdict', () => {
  it('passes a game that reached its first frame, took its tap path and answered one input', () => {
    expect(judgePlay(played())).toEqual({ failures: [], unchecked: [] });
  });

  /* #1252: the shell dropped `ready` over the manifest's `/a/` logo; the bridge timed out and the shell said Try again. */
  it('fails a game whose bridge never became ready', () => {
    const verdict = judgePlay(
      played({
        bridgeState: 'error',
        trace: [{ ms: 900, dir: 'window', t: 'hello', n: 1 }],
        bootMs: null,
        tryAgain: true,
        frameStddev: null,
        idleChange: null,
        inputChange: null,
        input: null,
      }),
    );
    expect(verdict.failures).toEqual([
      'bridge error',
      'the shell shows Try again',
      'the game never reported load.frame',
    ]);
  });

  /* #1266: the entry module ran twice; the copy the shell talked to never drew, so no first frame ever arrived. */
  it('fails a game that connected but never reported a first frame', () => {
    const verdict = judgePlay(
      played({
        trace: booted.filter((entry) => entry.t !== 'load.frame'),
        bootMs: null,
        frameStddev: null,
        idleChange: null,
        inputChange: null,
        input: null,
      }),
    );
    expect(verdict.failures).toEqual(['the game never reported load.frame']);
  });

  /* #1267: Blobs went quiet compiling shaders, the shell called it a stall and kept Try again over a running game. */
  it('fails a stall the shell never recovered from, and passes one it did', () => {
    const stuck = judgePlay(played({ bridgeState: 'error', tryAgain: true, bootMs: null }));
    expect(stuck.failures).toEqual(['bridge error', 'the shell shows Try again', expect.stringMatching(/in time/u)]);
    expect(judgePlay(played({ bootMs: 52_000 })).failures).toEqual([]);
  });

  it('fails a frame that stays blank, a tap that never appears, and an input that changes nothing', () => {
    expect(judgePlay(played({ frameStddev: 1.2 })).failures).toEqual([
      'the game frame is blank (luminance spread 1.2)',
    ]);
    expect(
      judgePlay(played({ tapFailed: 'Endless', frameStddev: null, idleChange: null, inputChange: null, input: null }))
        .failures,
    ).toEqual(['could not tap "Endless"']);
    // A falling piece changes the frame without input: the input must change clearly more than waiting does.
    expect(judgePlay(played({ input: 'key', idleChange: 0.03, inputChange: 0.04 })).failures).toEqual([
      'one key did not change the frame (idle 3%, input 4%)',
    ]);
  });

  it('fails a booted game when no input could be tried or the check stopped', () => {
    expect(judgePlay(played({ idleChange: null, inputChange: null, input: null })).failures).toEqual([
      'no input was tried',
    ]);
    expect(judgePlay(played({ stopped: 'over 170 s' })).failures).toEqual(['the check stopped: over 170 s']);
  });

  it('reports a game with no tap path as checked from its first screen', () => {
    expect(judgePlay(played({ tapPath: [] }))).toEqual({
      failures: [],
      unchecked: ['the manifest names no tap path: checked from the first screen'],
    });
  });
});

describe('qa play-check manifest', () => {
  it("takes the first mode's tap path, then the play area's", () => {
    expect(firstTapPath({ modes: [{ tap: 'Play > Continue>Start' }], playArea: { tap: 'Play' } })).toEqual([
      'Play',
      'Continue',
      'Start',
    ]);
    expect(firstTapPath({ playArea: { tap: 'Play>Endless>Blobs>Play' } })).toEqual([
      'Play',
      'Endless',
      'Blobs',
      'Play',
    ]);
    expect(firstTapPath({ playArea: false })).toEqual([]);
  });

  it('presses the key bound to moving right, else any move', () => {
    expect(moveKey({ controlBindings: { KeyA: 'move.left', ArrowRight: 'move.right', Space: 'hardDrop' } })).toBe(
      'ArrowRight',
    );
    expect(moveKey({ controlBindings: { KeyW: 'move.up' } })).toBe('KeyW');
    expect(moveKey({ controlBindings: { Space: 'jump' } })).toBeUndefined();
  });
});

describe('qa play-check game API', () => {
  const base = { gameId: 'g_1', buildId: 'build_1', title: 'Blobs', doc: { v: 1 } };

  it('opens the game at the build under test', () => {
    expect(gameApiAnswer({ ...base, method: 'GET', path: '/branches/main/design' })).toEqual({
      status: 200,
      body: { rev: 1, buildId: 'build_1', doc: { v: 1 } },
    });
    expect(gameApiAnswer({ ...base, method: 'GET', path: '' }).body).toMatchObject({ id: 'g_1', title: 'Blobs' });
    expect(gameApiAnswer({ ...base, method: 'GET', path: '/saves' })).toEqual({ status: 200, body: { slots: [] } });
    expect(gameApiAnswer({ ...base, method: 'GET', path: '/review-rounds' }).status).toBe(404);
  });

  /* The QA account plays someone else's game: a play count or a save must never land on it. */
  it('absorbs every write', () => {
    for (const method of ['POST', 'PUT', 'DELETE'])
      expect(gameApiAnswer({ ...base, method, path: '/saves/auto' })).toEqual({ status: 204 });
  });
});

describe('qa play-check frames', () => {
  const flat = (color: string) =>
    sharp({ create: { width: 64, height: 64, channels: 3, background: color } })
      .png()
      .toBuffer();
  const split = async (left: string, right: string) =>
    sharp(await flat(left))
      .composite([{ input: await flat(right).then((png) => sharp(png).resize(32, 64).toBuffer()), left: 32, top: 0 }])
      .png()
      .toBuffer();

  it('calls a flat frame blank and a drawn one not', async () => {
    expect(await frameStddev(await flat('#2d2a33'))).toBeLessThan(1);
    expect(await frameStddev(await split('#2d2a33', '#f0e6c8'))).toBeGreaterThan(50);
  });

  it('measures how much of the frame changed', async () => {
    const before = await split('#000000', '#000000');
    expect(await changedShare(before, before)).toBe(0);
    expect(await changedShare(before, await split('#000000', '#ffffff'))).toBeCloseTo(0.5, 1);
  });
});
