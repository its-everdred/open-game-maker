import { mkdtemp, mkdir, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

const injected = vi.hoisted(() => ({ failCardWrite: false, failCleanup: false }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      if (injected.failCardWrite && String(args[0]).includes('.unity-card-')) {
        await actual.writeFile(...args);
        throw new Error('injected card write failure');
      }
      return actual.writeFile(...args);
    },
    rm: async (...args: Parameters<typeof actual.rm>) => {
      if (injected.failCleanup && String(args[0]).includes('.unity-card-')) throw new Error('injected cleanup failure');
      return actual.rm(...args);
    },
  };
});
vi.mock('../src/packs/unity/plan.js', () => ({
  planUnityAssembly: vi.fn(async () => []),
  inspectUnityAssembly: vi.fn(async () => [{ transformId: 'root/2', name: 'House', parentId: null }]),
}));
vi.mock('../src/packs/unity/export.js', () => ({
  exportUnityAssembly: vi.fn(async (_plan, path: string) => writeFile(path, 'glb', { flag: 'wx' })),
}));
vi.mock('@ogm/asset-measure', () => ({
  measureGltf: vi.fn(async () => ({
    geometry: {
      bounds_m: { min: [0, 0, 0], max: [1, 2, 1] },
      pivot: 'center',
      triangles: 12,
      vertices: 8,
      normalized: false,
    },
  })),
}));
import { assemblePackBuilding } from '../src/packs/unity/assemble.js';
import { exportUnityAssembly } from '../src/packs/unity/export.js';
import { command } from '../src/commands/packs/assemble.js';
import type { GmContext } from '../src/command.js';

it('publishes a measured building card inheriting confirmed pack rights and refuses mixed-rights packs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gm-assembly-card-'));
  const pack = join(root, 'packs', 'example');
  try {
    await mkdir(join(pack, 'v1', 'extracted'), { recursive: true });
    await mkdir(join(pack, 'cards'));
    await writeFile(
      join(pack, 'collection.card.json'),
      JSON.stringify({
        id: 't1:example@v1',
        status: 'measured',
        license: 'LicenseRef-owned',
        rights: {
          uses: ['in-game'],
          audience: 'private',
          redistribution: 'in-build',
          basis: [
            {
              type: 'license',
              confirmed_by: 'operator',
              uses: ['in-game'],
              audience: 'private',
              redistribution: 'in-build',
            },
          ],
        },
      }),
    );
    await writeFile(join(pack, 'v1', 'extracted', 'house.prefab'), 'fixture');
    const options = { assetsRoot: root, pack: 'example', source: 'house.prefab', slug: 'house', title: 'House' };
    const inspected = await assemblePackBuilding({ ...options, listOnly: true });
    expect(inspected.nodes).toEqual([{ id: 'root/2', name: 'House', parent: null }]);
    expect(vi.mocked(exportUnityAssembly)).not.toHaveBeenCalled();
    const lines: string[] = [];
    const ctx = { cwd: root, assetsRoot: root, json: true, out: (line: string) => lines.push(line) } as GmContext;
    expect(await command.run(ctx, ['example', 'house.prefab'], { list: true })).toBe(0);
    expect(JSON.parse(lines[0]!)).toEqual([{ id: 'root/2', name: 'House', parent: null }]);
    const result = await assemblePackBuilding(options);
    expect(result.id).toBe('t1:example/assembled-house@v1');
    await rename(join(pack, 'v1', 'extracted'), join(pack, 'v1', 'saved'));
    await mkdir(join(root, 'foreign'));
    await writeFile(join(root, 'foreign', 'house.prefab'), 'foreign');
    await symlink(join(root, 'foreign'), join(pack, 'v1', 'extracted'));
    await expect(assemblePackBuilding({ ...options, slug: 'foreign' })).rejects.toThrow('escapes the licensed pack');
    await rm(join(pack, 'v1', 'extracted'));
    await rename(join(pack, 'v1', 'saved'), join(pack, 'v1', 'extracted'));
    expect(JSON.parse(await readFile(join(pack, 'cards', 'assembled-house.card.json'), 'utf8'))).toMatchObject({
      kind: 'model',
      subkind: 'building',
      flags: ['needs-review'],
      collection: 't1:example@v1',
      describe: { objects: ['building'] },
      source: { files: [{ path: 'assembled/house.glb' }] },
    });
    await assemblePackBuilding({ ...options, slug: 'selected', pieceIds: ['root/1', 'root/2'] });
    const selectedCard = JSON.parse(await readFile(join(pack, 'cards', 'assembled-selected.card.json'), 'utf8'));
    expect(JSON.parse(selectedCard.provenance['*'].input)).toEqual({
      source: 'house.prefab',
      pieces: ['root/1', 'root/2'],
    });
    await writeFile(join(pack, 'cards', 'assembled-other.card.json'), '{}');
    await expect(assemblePackBuilding({ ...options, slug: 'other' })).rejects.toMatchObject({ code: 'EEXIST' });
    await expect(stat(join(pack, 'v1', 'extracted', 'assembled', 'other.glb'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect((await readdir(join(pack, 'cards'))).some((name) => name.startsWith('.unity-card-'))).toBe(false);
    injected.failCardWrite = true;
    await expect(assemblePackBuilding({ ...options, slug: 'retry' })).rejects.toThrow('injected card write failure');
    injected.failCardWrite = false;
    await expect(stat(join(pack, 'cards', 'assembled-retry.card.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(join(pack, 'v1', 'extracted', 'assembled', 'retry.glb'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(assemblePackBuilding({ ...options, slug: 'retry' })).resolves.toMatchObject({
      id: 't1:example/assembled-retry@v1',
    });
    injected.failCleanup = true;
    await expect(assemblePackBuilding({ ...options, slug: 'cleanup' })).resolves.toMatchObject({
      id: 't1:example/assembled-cleanup@v1',
    });
    injected.failCleanup = false;
    await expect(stat(join(pack, 'cards', 'assembled-cleanup.card.json'))).resolves.toBeTruthy();
    await expect(stat(join(pack, 'v1', 'extracted', 'assembled', 'cleanup.glb'))).resolves.toBeTruthy();
    vi.mocked(exportUnityAssembly).mockImplementationOnce(async (_plan, output) => {
      await writeFile(output, 'glb', { flag: 'wx' });
      await writeFile(join(pack, 'collection.card.json'), JSON.stringify({ id: 't1:example@v1', status: 'rejected' }));
    });
    await expect(assemblePackBuilding({ ...options, slug: 'changed' })).rejects.toThrow('collection rights changed');
    await expect(stat(join(pack, 'v1', 'extracted', 'assembled', 'changed.glb'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await writeFile(
      join(pack, 'collection.card.json'),
      JSON.stringify({
        id: 't1:example@v1',
        status: 'measured',
        license: 'LicenseRef-owned',
        rights: {
          uses: ['in-game'],
          audience: 'private',
          redistribution: 'in-build',
          basis: [
            {
              type: 'license',
              confirmed_by: 'operator',
              uses: ['in-game'],
              audience: 'private',
              redistribution: 'in-build',
            },
          ],
        },
      }),
    );
    await writeFile(
      join(pack, 'collection.card.json'),
      JSON.stringify({
        id: 't1:example@v1',
        status: 'measured',
        license: 'LicenseRef-owned',
        rights: {
          uses: ['in-game'],
          audience: 'private',
          redistribution: 'in-build',
          basis: [{ type: 'license', confirmed_by: 'operator', uses: [], audience: 'private', redistribution: 'none' }],
        },
      }),
    );
    await expect(assemblePackBuilding({ ...options, slug: 'denied' })).rejects.toThrow('confirmed tier-1');
    await writeFile(
      join(pack, 'collection.card.json'),
      JSON.stringify({
        id: 't1:example@v1',
        status: 'measured',
        license: 'LicenseRef-owned',
        rights: {
          uses: ['in-game'],
          audience: 'private',
          redistribution: 'in-build',
          basis: [
            {
              type: 'license',
              confirmed_by: 'operator',
              uses: ['in-game'],
              audience: 'private',
              redistribution: 'in-build',
            },
          ],
        },
      }),
    );
    await writeFile(join(pack, 'cards', 'restricted.card.json'), JSON.stringify({ rights: { uses: [] } }));
    await expect(assemblePackBuilding({ ...options, slug: 'other' })).rejects.toThrow('per-asset rights');
  } finally {
    injected.failCardWrite = false;
    injected.failCleanup = false;
    await rm(root, { recursive: true, force: true });
  }
});
