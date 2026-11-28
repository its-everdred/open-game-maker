import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { MIGRATIONS_DIR, migrate } from '../src/migrate.js';
import { openDb } from '../src/open.js';

it('preserves historical aggregate play counts when upgrading', () => {
  const migration = '20261118033354_game_play_sessions.sql';
  const dir = mkdtempSync(join(tmpdir(), 'ogm-play-count-'));
  const { sqlite } = openDb(':memory:');
  try {
    for (const file of readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.sql') && file < migration)) {
      copyFileSync(join(MIGRATIONS_DIR, file), join(dir, file));
    }
    migrate({ sqlite, dir });
    sqlite.exec(`
      INSERT INTO families (id, name, owner_user_id, created_at) VALUES ('f', 'Family', 'u', '2026-01-01');
      INSERT INTO games (id, family_id, owner_id, title, visibility, repo_visibility, created_at)
        VALUES ('g', 'f', 'u', 'Game', 'private', 'private', '2026-01-01');
      INSERT INTO creator_analytics_daily (game_id, day, release_id, metric, scope, value) VALUES
        ('g', '2026-11-01', '', 'plays', '', 3),
        ('g', '2026-11-02', '', 'plays', '', 4),
        ('g', '2026-11-02', 'release', 'plays', '', 4),
        ('g', '2026-11-02', '', 'players', '', 2);
    `);
    expect(migrate({ sqlite }).applied).toEqual([
      migration,
      '20261120131223_prototype_review_content.sql',
      '20261120140217_prototype_review_sweep_state.sql',
      '20261120220454_game_drafts.sql',
      '20261123020745_energy_admin.sql',
      '20261123185739_scene_store.sql',
      '20261124030313_client_telemetry.sql',
      '20261127002110_fixed_roughhouse.sql',
      '20261127225901_report_delivery.sql',
    ]);
    expect(sqlite.prepare('SELECT game_id, plays FROM game_play_totals').all()).toEqual([{ game_id: 'g', plays: 7 }]);
    expect(migrate({ sqlite }).applied).toEqual([]);
  } finally {
    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
