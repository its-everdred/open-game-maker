import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { readMasks } from './masks.js';

it('requires reviewed entries and limits mask reasons', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ogm-glass-masks-'));
  const file = join(dir, 'masks.json');
  try {
    await writeFile(file, JSON.stringify({ Home: [{ reason: 'avatar', x: 0, y: 0, width: 1, height: 1 }] }));
    expect(await readMasks(file, 'Home')).toHaveLength(1);
    await expect(readMasks(file, 'Settings')).rejects.toThrow('No reviewed mask entry');
    await writeFile(file, JSON.stringify({ Home: [{ reason: 'hide-differences', x: 0, y: 0, width: 1, height: 1 }] }));
    await expect(readMasks(file, 'Home')).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
