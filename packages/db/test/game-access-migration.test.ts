import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { MIGRATIONS_DIR, migrate } from '../src/migrate.js';
import { openDb } from '../src/open.js';

it('keeps an existing pending invitation hidden through the access migration', () => {
  const migration = '20261128094519_game_access.sql';
  const dir = mkdtempSync(join(tmpdir(), 'ogm-access-migration-'));
  const { sqlite } = openDb(':memory:');
  try {
    for (const file of readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.sql') && file < migration)) {
      copyFileSync(join(MIGRATIONS_DIR, file), join(dir, file));
    }
    migrate({ sqlite, dir });
    sqlite.exec(`
      INSERT INTO families (id, name, owner_user_id, created_at) VALUES ('f', 'Family', 'u', '2026-01-01');
      INSERT INTO games (id, family_id, owner_id, title, visibility, repo_visibility, created_at)
        VALUES ('g', 'f', 'u', 'Game', 'listed', 'private', '2026-01-01');
      INSERT INTO allowed_users (email, role, added_by, added_at)
        VALUES ('invited@example.test', 'maker', 'u', '2026-01-01');
    `);
    expect(migrate({ sqlite }).applied).toContain(migration);
    expect(sqlite.prepare('SELECT game_id, email, access FROM game_access').all()).toEqual([
      { game_id: 'g', email: 'invited@example.test', access: 'hide' },
    ]);
  } finally {
    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
