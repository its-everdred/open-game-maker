import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { gameDir } from '../src/outbox.js';

// A monorepo (Open-Games) holds many games under games/<slug>/. Each game's rejection ledger must stay with that
// game: Blobs' "goo blobs, never gems" must never constrain a sibling game.
describe('gameDir', () => {
  const repo = mkdtempSync(join(tmpdir(), 'gm-gamedir-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  const blobs = join(repo, 'games', 'blobs');
  mkdirSync(join(blobs, 'src'), { recursive: true });
  writeFileSync(join(blobs, 'gm.manifest.json'), '{}');

  it("answers the game's own folder from anywhere inside it", () => {
    expect(gameDir(blobs, repo)).toBe(blobs);
    expect(gameDir(join(blobs, 'src'), repo)).toBe(blobs);
  });

  it('answers the repository root for a one-game repository or outside any game', () => {
    expect(gameDir(repo, repo)).toBe(repo);
    expect(gameDir(join(repo, 'games'), repo)).toBe(repo);
  });
});
