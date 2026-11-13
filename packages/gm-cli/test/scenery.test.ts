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
});
