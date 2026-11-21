import { lstatSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AssetsLockSchema } from '@ogm/contracts';

import { readLock, upsertLock, writeLock } from '../src/lock.js';
import { tempDir } from './helpers.js';

const ENTRY = {
  id: 't3:coin-hop/boss-door',
  sha256: '0'.repeat(64),
  path: 'assets/model/coin-hop/boss-door.glb',
  license: 'LicenseRef-made-by-agent',
  rights: {
    uses: ['in-game'] as const,
    audience: 'public' as const,
    redistribution: 'free' as const,
    attribution: null,
  },
  added: '2026-11-01',
};

describe('asset lock I/O', () => {
  it('returns null when no lock exists and writes sorted, parseable JSON', async () => {
    const cwd = tempDir();
    expect(await readLock(cwd)).toBeNull();
    const first = { ...ENTRY, id: 't3:coin-hop/a-door', path: 'assets/model/coin-hop/a-door.glb' };
    await writeLock(cwd, { version: 1, family: 'chunky-low-poly', pov: 'iso', assets: [ENTRY, first] });
    const text = readFileSync(join(cwd, 'assets.lock.json'), 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    expect((await readLock(cwd))?.assets.map((entry) => entry.id)).toEqual([first.id, ENTRY.id]);
  });

  it('sorts numeric suffixes in the codepoint order required by the lock schema', async () => {
    const cwd = tempDir();
    const ids = ['t1:stone/stone-a2@1', 't1:stone/stone-a13@1', 't1:stone/stone-a1@1'];
    const entries = ids.map((id) => ({ ...ENTRY, id }));

    await writeLock(cwd, { version: 1, family: 'chunky-low-poly', pov: 'iso', assets: entries });

    const lock = JSON.parse(readFileSync(join(cwd, 'assets.lock.json'), 'utf8')) as unknown;
    expect(AssetsLockSchema.safeParse(lock).success).toBe(true);
    expect((lock as { assets: Array<{ id: string }> }).assets.map(({ id }) => id)).toEqual([
      't1:stone/stone-a13@1',
      't1:stone/stone-a1@1',
      't1:stone/stone-a2@1',
    ]);
  });

  it('upserts an entry by id without mutating the original lock', () => {
    const lock = { version: 1 as const, family: 'chunky-low-poly' as const, pov: 'iso' as const, assets: [ENTRY] };
    const changed = upsertLock(lock, { ...ENTRY, sha256: '1'.repeat(64) });
    expect(changed.assets[0]?.sha256).toBe('1'.repeat(64));
    expect(lock.assets[0]?.sha256).toBe('0'.repeat(64));
  });

  it('names an invalid lockfile instead of returning unvalidated data', async () => {
    const cwd = tempDir();
    writeFileSync(join(cwd, 'assets.lock.json'), '{"version":1}');
    await expect(readLock(cwd)).rejects.toThrow('assets.lock.json is invalid');
  });

  it('publishes a complete lock without following an existing destination symlink', async () => {
    const cwd = tempDir();
    const victim = join(cwd, 'victim.json');
    const lockPath = join(cwd, 'assets.lock.json');
    writeFileSync(victim, 'keep-me\n');
    symlinkSync(victim, lockPath);
    await writeLock(cwd, { version: 1, family: 'chunky-low-poly', pov: 'iso', assets: [ENTRY] });
    expect(readFileSync(victim, 'utf8')).toBe('keep-me\n');
    expect(lstatSync(lockPath).isSymbolicLink()).toBe(false);
    expect((await readLock(cwd))?.assets).toHaveLength(1);
  });
});
