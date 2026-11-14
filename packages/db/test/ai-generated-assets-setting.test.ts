import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { MIGRATIONS_DIR, migrate } from '../src/migrate.js';
import { openDb } from '../src/open.js';

const MIGRATION = '20261110053451_allow_ai_generated_assets.sql';
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('AI-generated asset game setting migration', () => {
  it('preserves existing games, children and triggers while constraining the new setting', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ogm-ai-generated-assets-setting-'));
    dirs.push(dir);
    for (const file of readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.sql') && file < MIGRATION)) {
      copyFileSync(join(MIGRATIONS_DIR, file), join(dir, file));
    }
    const { sqlite } = openDb(':memory:');
    migrate({ sqlite, dir });
    sqlite.exec(`
      INSERT INTO families (id, name, owner_user_id, created_at)
      VALUES ('f_1', 'Family', 'u_1', '2026-11-09T00:00:00.000Z');
      INSERT INTO games (id, family_id, owner_id, title, visibility, repo_visibility, created_at)
      VALUES ('g_1', 'f_1', 'u_1', 'Game', 'private', 'private', '2026-11-09T00:00:00.000Z');
      INSERT INTO game_slugs (slug, game_id, created_at)
      VALUES ('game', 'g_1', '2026-11-09T00:00:00.000Z');
      INSERT INTO branches (id, game_id, name, git_ref, head_rev, status, created_by, created_at)
      VALUES ('b_1', 'g_1', 'main', 'refs/heads/main', 0, 'active', 'u_1', '2026-11-09T00:00:00.000Z');
      INSERT INTO jobs
        (id, game_id, branch_id, family_id, creator_id, kind, complexity, state, start, slot,
         plan, reservation, hard_cap_micro_usd, created_at, updated_at)
      VALUES
        ('j_1', 'g_1', 'b_1', 'f_1', 'u_1', 'feature', 1, 'running', 'now', 'edit',
         '{}', '{}', 1, '2026-11-09T00:00:00.000Z', '2026-11-09T00:00:00.000Z');
    `);

    expect(migrate({ sqlite }).applied).toEqual([
      MIGRATION,
      '20261114130207_review_rounds.sql',
    ]);
    expect(sqlite.prepare('SELECT id, allow_ai_generated_assets FROM games').get()).toEqual({
      id: 'g_1',
      allow_ai_generated_assets: 1,
    });
    expect(sqlite.prepare('SELECT slug, game_id FROM game_slugs').get()).toEqual({ slug: 'game', game_id: 'g_1' });
    expect(sqlite.prepare('SELECT id, game_id FROM branches').get()).toEqual({ id: 'b_1', game_id: 'g_1' });
    expect(sqlite.prepare('SELECT id, game_id FROM jobs').get()).toEqual({ id: 'j_1', game_id: 'g_1' });
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(() => sqlite.prepare('UPDATE games SET allow_ai_generated_assets = 2').run()).toThrow(/CHECK/);
    expect(() => sqlite.prepare("UPDATE games SET forked_from_game_id = 'g_source' WHERE id = 'g_1'").run()).toThrow(
      /fork provenance is immutable/,
    );
    sqlite.close();
  });
});
