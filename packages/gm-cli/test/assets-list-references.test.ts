import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AssetsLock } from '@ogm/contracts';

import { ORC, SYNTY, WALL, preparedLibrary, useOrc } from './assets-fixture.js';
import { gm, tempDir } from './helpers.js';

function writeSource(cwd: string, file: string, text: string): void {
  mkdirSync(join(cwd, file, '..'), { recursive: true });
  writeFileSync(join(cwd, file), text);
}

function readLockFile(cwd: string): AssetsLock {
  return JSON.parse(readFileSync(join(cwd, 'assets.lock.json'), 'utf8')) as AssetsLock;
}

/*
 * #627: the game's asset list (assets.lock.json) is the record of what ships. Agents may use anything in the library,
 * so the build must refuse code that names an asset the list does not hold, and the list must say what it no longer
 * needs.
 */
describe("the game's asset list", () => {
  it('records the curated set an entry belongs to, and none for a pack outside every set', async () => {
    const cwd = tempDir();
    const root = preparedLibrary();
    await useOrc(cwd, root);
    const added = await gm(['assets', 'use', SYNTY, '--exception', 'intentional contrast'], {
      cwd,
      env: { OGM_ASSETS_ROOT: root },
    });
    expect(added.code).toBe(0);
    const lock = readLockFile(cwd);
    expect(lock.minor).toBe(6);
    expect(lock.assets.find((entry) => entry.id === SYNTY)).toMatchObject({ set: 'synty-polygon' });
    expect(lock.assets.find((entry) => entry.id === ORC)).not.toHaveProperty('set');
  });

  it('fails the build naming an asset the code uses after its entry is removed', async () => {
    const cwd = tempDir();
    const root = preparedLibrary();
    await gm(['assets', 'use', ORC, WALL, '--family', 'chunky-low-poly', '--pov', 'iso'], {
      cwd,
      env: { OGM_ASSETS_ROOT: root },
    });
    writeSource(cwd, 'src/main.ts', `load('${ORC}');\nload("${WALL}");\n`);
    expect((await gm(['check', 'assets'], { cwd, env: { OGM_ASSETS_ROOT: root } })).code).toBe(0);

    const lock = readLockFile(cwd);
    writeFileSync(
      join(cwd, 'assets.lock.json'),
      `${JSON.stringify({ ...lock, assets: lock.assets.filter((entry) => entry.id !== WALL) }, null, 2)}\n`,
    );
    const built = await gm(['build', 'assets'], { cwd, env: { OGM_ASSETS_ROOT: root } });
    expect(built.code).toBe(1);
    expect(built.err.join('\n')).toContain(
      `${WALL}  unlisted  src/main.ts uses it but assets.lock.json does not list it. Try: gm assets use ${WALL}`,
    );
  });

  it('fails a game with no list whose code names an asset', async () => {
    const cwd = tempDir();
    writeSource(cwd, 'index.html', `<img data-asset="t3:coin-hop/sprite/coin">`);
    const checked = await gm(['check', 'assets'], { cwd });
    expect(checked.code).toBe(1);
    expect(checked.err.join('\n')).toContain('t3:coin-hop/sprite/coin  unlisted  index.html uses it');
    expect(checked.err.join('\n')).toContain('Try: gm assets register <path>');
  });

  it('ignores ids in test files, which never ship', async () => {
    const cwd = tempDir();
    const root = preparedLibrary();
    await useOrc(cwd, root);
    writeSource(cwd, 'src/main.ts', `load('${ORC}');\n`);
    writeSource(cwd, 'src/main.test.ts', `expect('${WALL}');\n`);
    expect((await gm(['check', 'assets'], { cwd, env: { OGM_ASSETS_ROOT: root } })).code).toBe(0);
  });

  it('ignores ids named only in comments, and keeps ids in strings that hold comment markers', async () => {
    const cwd = tempDir();
    const root = preparedLibrary();
    await useOrc(cwd, root);
    writeSource(
      cwd,
      'src/main.ts',
      [
        `// was '${WALL}'`,
        `/** swapped for '${WALL}' */`,
        `const url = 'https://example.test/a'; load('${ORC}'); // '${WALL}'`,
        '',
      ].join('\n'),
    );
    writeSource(cwd, 'index.html', `<!-- "${WALL}" -->\n`);
    expect((await gm(['check', 'assets'], { cwd, env: { OGM_ASSETS_ROOT: root } })).code).toBe(0);
    expect((await gm(['assets', 'unused'], { cwd })).out).toEqual([]);

    writeSource(cwd, 'src/main.ts', `// load('${ORC}')\n`);
    expect((await gm(['assets', 'unused'], { cwd })).out).toEqual([`${ORC}  Models/GLB format/character-orc.glb`]);
  });

  it('lists entries the code no longer references, counting ids built at runtime and repo paths', async () => {
    const cwd = tempDir();
    const root = preparedLibrary();
    await gm(['assets', 'use', ORC, WALL, '--family', 'chunky-low-poly', '--pov', 'iso'], {
      cwd,
      env: { OGM_ASSETS_ROOT: root },
    });
    const before = await gm(['assets', 'unused'], { cwd });
    expect(before.out).toEqual([`${ORC}  Models/GLB format/character-orc.glb`, `${WALL}  Models/GLB format/wall.glb`]);

    writeSource(cwd, 'src/main.ts', 'const id = (name: string) => `t1:kenney-mini-dungeon/${name}@2.0`;\n');
    expect((await gm(['assets', 'unused'], { cwd })).out).toEqual([]);

    writeSource(cwd, 'src/main.ts', `load('${ORC}');\n`);
    writeSource(cwd, 'src/data/walls.json', '{"file": "Models/GLB format/wall.glb"}\n');
    const after = await gm(['assets', 'unused', '--json'], { cwd });
    expect(after).toEqual({ code: 0, out: [], err: [] });

    writeSource(cwd, 'src/data/walls.json', '{}\n');
    expect((await gm(['assets', 'unused', '--json'], { cwd })).out.map((line) => JSON.parse(line) as unknown)).toEqual([
      { id: WALL, path: 'Models/GLB format/wall.glb' },
    ]);
  });
});
