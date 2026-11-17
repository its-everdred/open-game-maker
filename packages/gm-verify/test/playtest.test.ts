import { describe, expect, it } from 'vitest';

import { addOnce, botKeys, botMoves, judgeSample, type PlaytestSample } from '../src/qa/playtest.js';

const BLOBS_BINDINGS = {
  KeyA: 'move.left',
  ArrowLeft: 'move.left',
  ArrowUp: 'rotateCW',
  Space: 'hardDrop',
  ArrowDown: 'softDrop',
  Enter: 'confirm',
  Backspace: 'back',
};

const clean: PlaytestSample = {
  boards: 1,
  selectable: [],
  callout: true,
  invariants: [{ name: 'one piece per cell', ok: true }],
};

describe('playtest bot', () => {
  it('never presses keys that leave the match, and marks drops', () => {
    const keys = botKeys(BLOBS_BINDINGS);
    expect(keys.map((key) => key.key)).not.toContain('Enter');
    expect(keys.map((key) => key.key)).not.toContain('Backspace');
    expect(keys.filter((key) => key.drop).map((key) => key.key)).toEqual(['ArrowDown', 'Space']);
  });

  it('replays the same inputs for the same seed, so a failure can be reproduced', () => {
    const keys = botKeys(BLOBS_BINDINGS);
    expect(botMoves(keys, 7, 40)).toEqual(botMoves(keys, 7, 40));
    expect(botMoves(keys, 7, 40)).not.toEqual(botMoves(keys, 8, 40));
  });

  it('drops a piece every fourth move so the board actually fills', () => {
    const keys = botKeys(BLOBS_BINDINGS);
    const drops = new Set(keys.filter((key) => key.drop).map((key) => key.key));
    const moves = botMoves(keys, 3, 40);
    for (let index = 3; index < moves.length; index += 4) {
      const move = moves[index]!;
      expect(move.kind === 'key' && drops.has(move.key)).toBe(true);
    }
  });

  it('taps inside the board when the game binds no keys', () => {
    const moves = botMoves([], 1, 10);
    for (const move of moves) {
      expect(move.kind).toBe('tap');
      if (move.kind === 'tap') {
        expect(move.x).toBeGreaterThanOrEqual(0);
        expect(move.x).toBeLessThan(1);
      }
    }
  });
});

describe('playtest verdict', () => {
  it('passes a clean sample', () => {
    expect(judgeSample(clean)).toEqual({ failures: [], unchecked: [] });
  });

  /* The defects Kevin found on his phone in Both mode (#866). */
  it('fails a duplicate board, HUD over the board, a colourless piece and selectable HUD text', () => {
    const { failures } = judgeSample({
      boards: 2,
      playArea: 'overlap: SCORE',
      selectable: ['SCORE'],
      callout: false,
      invariants: [
        { name: 'exactly one board', ok: false, detail: '2 boards' },
        { name: 'every piece has a colour', ok: false },
      ],
    });
    expect(failures).toEqual([
      '2 boards on screen, expected one',
      'board: overlap: SCORE',
      'long press selects text: "SCORE"',
      'no -webkit-touch-callout:none on the page',
      'game state: exactly one board (2 boards)',
      'game state: every piece has a colour',
    ]);
  });

  it('fails when no board is on screen during play', () => {
    expect(judgeSample({ ...clean, boards: 0 }).failures).toEqual(['no board on screen']);
  });

  it('reports a game without state checks as unchecked rather than failing it', () => {
    expect(judgeSample({ ...clean, invariants: null })).toEqual({
      failures: [],
      unchecked: ['game state: the game implements no qa.invariants()'],
    });
    expect(judgeSample({ ...clean, invariants: 'absent' }).failures).toEqual([]);
  });

  /* A game with `playArea: false` has no board; failing it for "no board" would block every such game. */
  it('skips the board checks for a game without a play area and says so', () => {
    expect(judgeSample({ ...clean, boards: 0, playArea: 'overlap: SCORE' }, { board: false })).toEqual({
      failures: [],
      unchecked: ['board: the game has no play area (playArea: false)'],
    });
  });

  it('keeps one line per defect seen across many samples', () => {
    const lines: string[] = [];
    addOnce(lines, ['a', 'b']);
    addOnce(lines, ['b', 'c']);
    expect(lines).toEqual(['a', 'b', 'c']);
  });
});
