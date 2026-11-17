import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

import type { PlaytestRun } from '../src/qa/playtest.js';

const exec = promisify(execFile);
const fixture = fileURLToPath(new URL('../../../apps/web/e2e/fixtures/bridge-game/', import.meta.url));
const runner = fileURLToPath(new URL('../dist/app-capture/playtest.js', import.meta.url));

/*
 * A two-mode fixture: "Good" draws one board under a clean HUD; "Bad" draws what Kevin met in Blobs' Both mode
 * (#866): a second board, a SCORE plate over the board, selectable HUD text, a colourless piece and a console error.
 */
const modes = `
const root = document.getElementById('canvas');
let state = { pieces: [{ colour: '#f00' }] };
window.__gmQa = {
  invariants: () => [
    { name: 'exactly one board', ok: document.querySelectorAll('[data-gm-play-area]').length === 1 },
    { name: 'every piece has a colour', ok: state.pieces.every((piece) => piece.colour) },
  ],
};
const board = () => '<div data-gm-play-area style="position:absolute;left:10%;top:20%;width:80%;height:60%;background:#333"></div>';
root.innerHTML = '<button id="good">Good</button><button id="bad">Bad</button>';
document.getElementById('good').onclick = () => {
  root.innerHTML = board() + '<div style="position:absolute;top:0;left:0">SCORE</div>';
};
document.getElementById('bad').onclick = () => {
  document.documentElement.classList.add('bad');
  state = { pieces: [{ colour: '#f00' }, { colour: '' }] };
  root.innerHTML = board() + board() + '<div style="position:absolute;top:30%;left:20%">SCORE</div>';
  console.error('board drawn twice');
};
`;

it('fails only the broken mode, naming each defect, and leaves a still per mode', async () => {
  expect(existsSync(runner)).toBe(true);
  const root = mkdtempSync(join(tmpdir(), 'gm-playtest-test-'));
  const game = join(root, 'game');
  const out = join(root, 'shots');
  try {
    cpSync(fixture, game, { recursive: true });
    const html = join(game, 'index.html');
    const source = readFileSync(html, 'utf8');
    const script = source.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
    if (!script) throw new Error('bridge fixture script missing');
    writeFileSync(join(game, 'fixture.js'), `${script}\n${modes}`);
    writeFileSync(
      html,
      source
        .replace(
          '<style>',
          '<style>html:not(.bad), html:not(.bad) body { user-select: none; -webkit-touch-callout: none; }\n',
        )
        .replace(/<script type="module">[\s\S]*?<\/script>/, '<script type="module" src="fixture.js"></script>'),
    );
    const plan = {
      game: { dist: game },
      modes: [
        { id: 'good', taps: ['Good'] },
        { id: 'bad', taps: ['Bad'] },
      ],
      seconds: 1,
      seed: 1,
      keys: [{ key: 'Space', action: 'hardDrop', drop: true }],
      software: process.env.GM_VERIFY_SOFTWARE_GL === '1',
      fast: true,
    };
    await exec(process.execPath, [runner, out, JSON.stringify(plan)], { timeout: 200_000 });
    const runs = JSON.parse(readFileSync(join(out, 'playtest.json'), 'utf8')) as PlaytestRun[];
    expect(runs.map((run) => [run.mode, run.viewport])).toEqual([
      ['good', '390x844'],
      ['bad', '390x844'],
    ]);
    expect(runs[0]!.failures).toEqual([]);
    expect(runs[0]!.unchecked.filter((line) => !line.startsWith('clip:'))).toEqual([]);
    const bad = runs[1]!.failures.join('\n');
    expect(bad).toContain('2 boards on screen, expected one');
    expect(bad).toContain('board: overlap');
    expect(bad).toContain('long press selects text: "SCORE"');
    expect(bad).toContain('no -webkit-touch-callout:none on the page');
    expect(bad).toContain('game state: exactly one board');
    expect(bad).toContain('game state: every piece has a colour');
    expect(bad).toContain('console: board drawn twice');
    for (const run of runs) expect(existsSync(join(out, run.still!))).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 220_000);
