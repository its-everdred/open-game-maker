import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ORC, preparedLibrary, useOrc } from './assets-fixture.js';
import { gm, tempDir } from './helpers.js';

describe('gm scenery', () => {
  it('adds, lists, and moves locked assets in the same scene file', async () => {
    const cwd = tempDir();
    await useOrc(cwd, preparedLibrary());
    expect((await gm(['scenery', 'add', 'oak', ORC, '--position', '1,0,2', '--layer', 'back'], { cwd })).code).toBe(0);
    expect((await gm(['scenery', 'list'], { cwd })).out.join('\n')).toContain(`oak  ${ORC}  1,0,2  back`);
    expect((await gm(['scenery', 'move', 'oak', '--position', '3,0,4'], { cwd })).code).toBe(0);
    expect(JSON.parse(readFileSync(join(cwd, 'scenery.json'), 'utf8')).items[0].position).toEqual([3, 0, 4]);
  });
  it('rejects unlocked assets and duplicate ids without changing the file', async () => {
    const cwd = tempDir();
    await useOrc(cwd, preparedLibrary());
    expect((await gm(['scenery', 'add', 'oak', ORC, '--position', '1,0,2'], { cwd })).code).toBe(0);
    const before = readFileSync(join(cwd, 'scenery.json'), 'utf8');
    expect((await gm(['scenery', 'add', 'other', 'missing', '--position', '1,0,2'], { cwd })).code).not.toBe(0);
    expect((await gm(['scenery', 'add', 'oak', ORC, '--position', '1,0,2'], { cwd })).code).not.toBe(0);
    expect(readFileSync(join(cwd, 'scenery.json'), 'utf8')).toBe(before);
  });
  it('refuses to render a locked model whose bytes changed', async () => {
    const cwd = tempDir();
    const root = preparedLibrary();
    await useOrc(cwd, root);
    expect((await gm(['scenery', 'add', 'oak', ORC, '--position', '1,0,2'], { cwd })).code).toBe(0);
    writeFileSync(join(root, 'packs/kenney-mini-dungeon/2.0/extracted/Models/GLB format/character-orc.glb'), 'changed');
    const result = await gm(['scenery', 'render'], { cwd, env: { OGM_ASSETS_ROOT: root } });
    expect(result.code).not.toBe(0);
    expect(result.err.join(' ')).toContain('sha256 does not match');
  });
  it('syncs creator edits from an effective design snapshot', async () => {
    const cwd = tempDir();
    await useOrc(cwd, preparedLibrary());
    const id = 'e_01K8ZTEMP00000000000000001';
    const doc = {
      schemaVersion: 1,
      globals: {
        'scenery.settings': {
          version: 1,
          terrain: [],
          lighting: 'night',
          camera: { position: [0, 5, 5], target: [0, 0, 0], zoom: 1 },
        },
      },
      entities: {
        [id]: {
          id,
          prefab: `scenery:${ORC}`,
          level: 'main',
          origin: 'creator',
          props: { pose: { position: [3, 0, 2], rotationY: 90 } },
        },
      },
    };
    writeFileSync(join(cwd, 'snapshot.json'), JSON.stringify({ rev: 2, doc }));
    expect((await gm(['scenery', 'sync', '--design', 'snapshot.json'], { cwd })).code).toBe(0);
    const item = JSON.parse(readFileSync(join(cwd, 'scenery.json'), 'utf8')).items[0];
    expect(item).toMatchObject({ id, assetId: ORC, position: [3, 0, 2], rotation: [0, Math.PI / 2, 0] });
    const before = readFileSync(join(cwd, 'scenery.json'), 'utf8');
    writeFileSync(join(cwd, 'snapshot.json'), JSON.stringify({ rev: 3, doc: { ...doc, globals: {} } }));
    expect((await gm(['scenery', 'sync', '--design', 'snapshot.json'], { cwd })).code).not.toBe(0);
    expect(readFileSync(join(cwd, 'scenery.json'), 'utf8')).toBe(before);
  });
});
