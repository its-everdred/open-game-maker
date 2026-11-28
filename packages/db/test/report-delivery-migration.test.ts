import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { MIGRATIONS_DIR, migrate } from '../src/migrate.js';
import { openDb } from '../src/open.js';

it('preserves existing reports and queues while adding scoped request deduplication', () => {
  const migration = '20261127225901_report_delivery.sql';
  const dir = mkdtempSync(join(tmpdir(), 'ogm-report-migration-'));
  const { sqlite } = openDb(':memory:');
  try {
    for (const file of readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.sql') && file < migration)) {
      copyFileSync(join(MIGRATIONS_DIR, file), join(dir, file));
    }
    migrate({ sqlite, dir });
    sqlite.exec(`
      INSERT INTO families (id, name, owner_user_id, created_at) VALUES ('f', 'Family', 'owner', 'now');
      INSERT INTO games (id, family_id, owner_id, title, visibility, repo_visibility, created_at)
        VALUES ('g', 'f', 'owner', 'Game', 'listed', 'private', 'now');
      INSERT INTO reports (id, game_id, build_hash, text, signature, route, reproduction, reporter_id, created_at)
        VALUES ('r1', 'g', 'b', 'old report', 's', 'stored', 'wrong_behaviour', 'player', 'now'),
               ('r2', 'g', 'b', 'another', 's', 'stored', 'wrong_behaviour', 'player', 'now');
      INSERT INTO platform_issue_queue (id, title, body, labels_json, status, ref, created_at)
        VALUES ('qa_r1', 'Bug', 'body', '[]', 'pending', 'issue:1', 'now');
    `);
    expect(migrate({ sqlite }).applied).toEqual([migration]);
    expect(sqlite.prepare('SELECT id, text, screenshot, request_key FROM reports ORDER BY id').all()).toEqual([
      { id: 'r1', text: 'old report', screenshot: null, request_key: null },
      { id: 'r2', text: 'another', screenshot: null, request_key: null },
    ]);
    expect(sqlite.prepare('SELECT ref, next_attempt_at FROM platform_issue_queue WHERE id = ?').get('qa_r1')).toEqual({
      ref: 'issue:1',
      next_attempt_at: null,
    });
    sqlite.prepare('UPDATE reports SET request_key = ? WHERE id = ?').run('bug-1', 'r1');
    expect(() => sqlite.prepare('UPDATE reports SET request_key = ? WHERE id = ?').run('bug-1', 'r2')).toThrow();
    sqlite.prepare('UPDATE reports SET reporter_id = ? WHERE id = ?').run('other-player', 'r2');
    expect(() => sqlite.prepare('UPDATE reports SET request_key = ? WHERE id = ?').run('bug-1', 'r2')).not.toThrow();
  } finally {
    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
