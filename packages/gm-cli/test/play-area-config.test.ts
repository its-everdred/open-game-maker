import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { findPlayAreaGame } from '../src/play-area-config.js';
import { tempDir } from './helpers.js';

it('finds an SDK game nested in a workspace without a source manifest', () => {
  const root = tempDir();
  try {
    const game = join(root, 'games/example');
    mkdirSync(join(game, 'src'), { recursive: true });
    writeFileSync(join(game, 'package.json'), JSON.stringify({ dependencies: { '@gm/sdk': '*' } }));
    writeFileSync(join(game, 'index.html'), '');
    writeFileSync(join(game, 'src/main.ts'), '');
    mkdirSync(join(game, 'design'));
    expect(findPlayAreaGame(join(game, 'src'), root)).toBe(game);
    rmSync(join(game, 'design'), { recursive: true });
    expect(findPlayAreaGame(join(game, 'src'), root)).toBe(game);
    writeFileSync(join(game, 'package.json'), JSON.stringify({ devDependencies: { '@gm/sdk': '*' } }));
    expect(findPlayAreaGame(join(game, 'src'), root)).toBe(game);
    writeFileSync(join(game, 'package.json'), JSON.stringify({ peerDependencies: { '@gm/sdk': '*' } }));
    expect(findPlayAreaGame(join(game, 'src'), root)).toBe(game);
    expect(findPlayAreaGame(root, root)).toBeUndefined();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
