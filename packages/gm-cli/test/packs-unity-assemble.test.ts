import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

vi.mock('../src/packs/unity/plan.js', () => ({ planUnityAssembly: vi.fn(async () => []) }));
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
    const result = await assemblePackBuilding(options);
    expect(result.id).toBe('t1:example/assembled-house@v1');
    expect(JSON.parse(await readFile(join(pack, 'cards', 'assembled-house.card.json'), 'utf8'))).toMatchObject({
      kind: 'model',
      subkind: 'building',
      flags: ['needs-review'],
      collection: 't1:example@v1',
      describe: { objects: ['building'] },
      source: { files: [{ path: 'assembled/house.glb' }] },
    });
    await writeFile(join(pack, 'cards', 'assembled-other.card.json'), '{}');
    await expect(assemblePackBuilding({ ...options, slug: 'other' })).rejects.toMatchObject({ code: 'EEXIST' });
    await expect(stat(join(pack, 'v1', 'extracted', 'assembled', 'other.glb'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
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
    await rm(root, { recursive: true, force: true });
  }
});
