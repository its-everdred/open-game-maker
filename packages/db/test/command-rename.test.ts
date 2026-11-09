import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { MIGRATIONS_DIR, migrate } from '../src/migrate.js';
import { openDb } from '../src/open.js';

const RENAME = '20261109125710_command_rename.sql';
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function columns(sqlite: ReturnType<typeof openDb>['sqlite'], table: string): string[] {
  return sqlite
    .prepare<[], { name: string }>(`PRAGMA table_info(${table})`)
    .all()
    .map(({ name }) => name);
}

// "Checkpoint" became aiur's "Command" (#571). Commands already stored under the old names must survive the rename:
// a creator's open question would otherwise vanish from the build chat and the inbox after the upgrade.
describe('command rename migration', () => {
  it('keeps stored checkpoints as Commands', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ogm-command-rename-'));
    dirs.push(dir);
    for (const file of readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.sql') && file < RENAME)) {
      copyFileSync(join(MIGRATIONS_DIR, file), join(dir, file));
    }
    const { sqlite } = openDb(':memory:');
    migrate({ sqlite, dir });
    sqlite.exec(`
      INSERT INTO checkpoints (decision_id, job_id, daemon_slug, version, question, options, status, opened_at)
      VALUES ('d_1', 'j_1', 'game-1', 2, 'Which look?', '[]', 'open', '2026-11-08T10:00:00.000Z');
      INSERT INTO build_chat_messages (id, job_id, at, actor, kind, checkpoint_json)
      VALUES ('m_1', 'j_1', '2026-11-08T10:00:00.000Z', 'agent', 'checkpoint',
        '{"checkpoint_id":"cp_1","decision_id":"d_1","question":"Which look?","options":[],"status":"open"}');
      INSERT INTO build_chat_messages (id, job_id, at, actor, kind, text)
      VALUES ('m_2', 'j_1', '2026-11-08T10:01:00.000Z', 'agent', 'text', 'hello');
    `);

    expect(migrate({ sqlite }).applied).toEqual([RENAME]);

    expect(sqlite.prepare('SELECT decision_id, version, status FROM commands').all()).toEqual([
      { decision_id: 'd_1', version: 2, status: 'open' },
    ]);
    const rows = sqlite
      .prepare<[], { id: string; kind: string; command_json: string | null; text: string | null }>(
        'SELECT id, kind, command_json, text FROM build_chat_messages ORDER BY seq',
      )
      .all();
    expect(rows.map(({ id, kind, text }) => ({ id, kind, text }))).toEqual([
      { id: 'm_1', kind: 'command', text: null },
      { id: 'm_2', kind: 'text', text: 'hello' },
    ]);
    expect(JSON.parse(rows[0]!.command_json!)).toEqual({
      command_id: 'cp_1',
      decision_id: 'd_1',
      question: 'Which look?',
      options: [],
      status: 'open',
    });
    expect(columns(sqlite, 'design_decisions')).toContain('command_id');
    expect(columns(sqlite, 'command_reviews')).toContain('command_id');
    sqlite.close();
  });
});
