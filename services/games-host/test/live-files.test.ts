import { link, mkdir, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';

import { liveGeneration, openLiveFile } from '../src/live-files.js';

it('opens only regular files inside the selected generation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'live-files-'));
  try {
    const id = '11111111-1111-1111-1111-111111111111';
    const generation = join(root, 'versions', id);
    await mkdir(generation, { recursive: true });
    await writeFile(join(generation, 'index.html'), 'completed');
    await writeFile(join(root, 'secret'), 'private');
    await symlink(`versions/${id}`, join(root, 'current'));
    await symlink(join(root, 'secret'), join(generation, 'link'));
    await link(join(root, 'secret'), join(generation, 'hardlink'));
    execFileSync('mkfifo', [join(generation, 'pipe')]);
    const file = await openLiveFile(root, 'index.html');
    expect(await file?.readFile('utf8')).toBe('completed');
    await file?.close();
    expect(await openLiveFile(root, '../secret')).toBeNull();
    expect(await openLiveFile(root, 'link')).toBeNull();
    expect(await openLiveFile(root, 'hardlink')).toBeNull();
    expect(await openLiveFile(root, 'pipe')).toBeNull();
    expect(await openLiveFile(root, 'index.html', '../secret')).toBeNull();
    const older = await openLiveFile(root, 'index.html', id);
    expect(await older?.readFile('utf8')).toBe('completed');
    await older?.close();
    const next = '22222222-2222-2222-2222-222222222222';
    await mkdir(join(root, 'versions', next));
    await writeFile(join(root, 'versions', next, 'index.html'), 'new');
    await unlink(join(root, 'current'));
    await symlink(`versions/${next}`, join(root, 'current'));
    expect(await liveGeneration(root)).toBe(next);
    const stillOlder = await openLiveFile(root, 'index.html', id);
    expect(await stillOlder?.readFile('utf8')).toBe('completed');
    await stillOlder?.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
