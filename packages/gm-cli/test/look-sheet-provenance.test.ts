import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, it, vi } from 'vitest';

import { gm, tempDir } from './helpers.js';

vi.mock('@ogm/gm-verify', async (original) => ({
  ...(await original()),
  sideBySide: (_inputs: string[], out: string) => writeFileSync(out, 'sheet bytes'),
}));

it('records the sheet and approved target bytes used by the comparison', async () => {
  const root = tempDir('gm-sheet-');
  execFileSync('git', ['init', '-q'], { cwd: root });
  writeFileSync(join(root, 'gm.manifest.json'), '{}');
  mkdirSync(join(root, 'review'));
  writeFileSync(join(root, 'review/decisions.json'), '{"screens":{"play":{"target":"target.png"}}}');
  writeFileSync(join(root, 'target.png'), 'target bytes');
  writeFileSync(join(root, 'still.png'), 'still bytes');

  const result = await gm(['look', 'sheet', 'play', '--still', 'still.png'], { cwd: root });
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  expect(result.code).toBe(0);
  expect(JSON.parse(readFileSync(join(root, 'look/play.sheet.png.json'), 'utf8'))).toEqual({
    sheet: hash('sheet bytes'),
    target: hash('target bytes'),
    still: hash('still bytes'),
  });
});
