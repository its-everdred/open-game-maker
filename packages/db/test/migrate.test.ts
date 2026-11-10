import { copyFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { MIGRATIONS_DIR, migrate } from '../src/migrate.js';
import { openDb } from '../src/open.js';
import { appMeta } from '../src/schema/index.js';

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ogm-migrate-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('migrate', () => {
  it('applies the shipped migrations once and records them', () => {
    const { sqlite, db } = openDb(join(tempDir(), 'ogm.sqlite3'));
    expect(migrate({ sqlite })).toEqual({
      applied: [
        '20261101000000_app_meta.sql',
        '20261101114708_game_daemons.sql',
        '20261101122027_accounts.sql',
        '20261101133303_aiur_events.sql',
        '20261101135125_notify.sql',
        '20261101145358_analytics.sql',
        '20261101153851_auth.sql',
        '20261101170027_design_log.sql',
        '20261101172625_jobs_budget.sql',
        '20261101183204_build_chat.sql',
        '20261101194843_reports.sql',
        '20261101204433_rooms.sql',
        '20261101233648_job_tickets.sql',
        '20261102012011_reapply_reports.sql',
        '20261102021630_achievements.sql',
        '20261102021647_creator_analytics.sql',
        '20261102023444_nullable_branch_fork_sha.sql',
        '20261102023822_saves.sql',
        '20261102033839_scope_sessions.sql',
        '20261102050906_usage_samples.sql',
        '20261102054226_merge_plans.sql',
        '20261102092046_scope_session_revisions.sql',
        '20261102100555_report_triage.sql',
        '20261102110848_releases.sql',
        '20261102160540_game_abuse_flags.sql',
        '20261102161607_chat_attachments.sql',
        '20261103023559_games_forked_from.sql',
        '20261105220609_game_slugs.sql',
        '20261106011027_allow_list.sql',
        '20261106181658_daemons_by_game_slug.sql',
        '20261106213727_game_github_path.sql',
        '20261107003901_design_decisions.sql',
        '20261107225942_command_reviews.sql',
        '20261108035442_game_reviews.sql',
        '20261108055645_energy.sql',
        '20261108155353_review_drafts.sql',
        '20261109125710_command_rename.sql',
        '20261110022103_allow_ai_generated_assets.sql',
      ],
    });
    expect(migrate({ sqlite })).toEqual({ applied: [] });
    expect(
      db
        .select()
        .from(appMeta)
        .all()
        .map(({ key }) => key),
    ).toEqual([
      'migration:20261101000000_app_meta.sql',
      'migration:20261101114708_game_daemons.sql',
      'migration:20261101122027_accounts.sql',
      'migration:20261101133303_aiur_events.sql',
      'migration:20261101135125_notify.sql',
      'migration:20261101145358_analytics.sql',
      'migration:20261101153851_auth.sql',
      'migration:20261101170027_design_log.sql',
      'migration:20261101172625_jobs_budget.sql',
      'migration:20261101183204_build_chat.sql',
      'migration:20261101194843_reports.sql',
      'migration:20261101204433_rooms.sql',
      'migration:20261101233648_job_tickets.sql',
      'migration:20261102012011_reapply_reports.sql',
      'migration:20261102021630_achievements.sql',
      'migration:20261102021647_creator_analytics.sql',
      'migration:20261102023444_nullable_branch_fork_sha.sql',
      'migration:20261102023822_saves.sql',
      'migration:20261102033839_scope_sessions.sql',
      'migration:20261102050906_usage_samples.sql',
      'migration:20261102054226_merge_plans.sql',
      'migration:20261102092046_scope_session_revisions.sql',
      'migration:20261102100555_report_triage.sql',
      'migration:20261102110848_releases.sql',
      'migration:20261102160540_game_abuse_flags.sql',
      'migration:20261102161607_chat_attachments.sql',
      'migration:20261103023559_games_forked_from.sql',
      'migration:20261105220609_game_slugs.sql',
      'migration:20261106011027_allow_list.sql',
      'migration:20261106181658_daemons_by_game_slug.sql',
      'migration:20261106213727_game_github_path.sql',
      'migration:20261107003901_design_decisions.sql',
      'migration:20261107225942_command_reviews.sql',
      'migration:20261108035442_game_reviews.sql',
      'migration:20261108055645_energy.sql',
      'migration:20261108155353_review_drafts.sql',
      'migration:20261109125710_command_rename.sql',
      'migration:20261110022103_allow_ai_generated_assets.sql',
    ]);
    sqlite.close();
  });

  it('creates the aiur event, cursor, command and job projection tables', () => {
    const { sqlite } = openDb(':memory:');
    migrate({ sqlite });
    const tables = sqlite
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map(({ name }) => name);
    expect(tables).toEqual(expect.arrayContaining(['aiur_events', 'aiur_cursors', 'commands', 'job_projections']));
    const insert = sqlite.prepare(
      "INSERT OR IGNORE INTO aiur_events (daemon_slug, seq, topic, payload, observed_at) VALUES ('d', 1, 't', '{}', 'now')",
    );
    insert.run();
    expect(insert.run().changes).toBe(0);
    sqlite.close();
  });

  it('preserves branch history and leases while loosening the fork SHA constraint', () => {
    const dir = tempDir();
    const migration = '20261102023444_nullable_branch_fork_sha.sql';
    for (const file of readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.sql') && file < migration)) {
      copyFileSync(join(MIGRATIONS_DIR, file), join(dir, file));
    }
    const { sqlite } = openDb(':memory:');
    migrate({ sqlite, dir });
    sqlite.exec(`
      INSERT INTO families (id, name, owner_user_id, created_at)
      VALUES ('f_1', 'Family', 'u_1', '2026-11-01T16:00:00.000Z');
      INSERT INTO games (id, family_id, owner_id, title, visibility, repo_visibility, created_at)
      VALUES ('g_1', 'f_1', 'u_1', 'Game', 'private', 'private', '2026-11-01T16:00:00.000Z');
      INSERT INTO branches (id, game_id, name, git_ref, head_rev, status, created_by, created_at)
      VALUES ('b_1', 'g_1', 'main', 'refs/heads/main', 1, 'active', 'u_1', '2026-11-01T16:00:00.000Z');
      INSERT INTO design_transactions
        (id, game_id, branch_id, rev, base_rev, lease_token, actor, kind, label,
         base_build_id, commands_json, patches_json, inverse_json, created_at)
      VALUES
        ('tx_1', 'g_1', 'b_1', 1, 0, 0, 'u_1', 'system', 'seed',
         'build_1', '[]', '[]', '[]', '2026-11-01T16:00:00.000Z');
      INSERT INTO edit_leases (game_id, branch_id, holder_user_id, session_id, token, expires_at)
      VALUES ('g_1', 'b_1', 'u_1', 'session', 1, '2026-11-01T16:02:00.000Z');
      INSERT INTO reapply_reports (game_id, branch_id, from_build_id, to_build_id, report_json, computed_at)
      VALUES ('g_1', 'b_1', 'build_1', 'build_2', '{}', '2026-11-01T16:03:00.000Z');
    `);

    copyFileSync(join(MIGRATIONS_DIR, migration), join(dir, migration));
    expect(migrate({ sqlite, dir }).applied).toEqual([migration]);
    expect(sqlite.prepare('SELECT COUNT(*) FROM branches').pluck().get()).toBe(1);
    expect(sqlite.prepare('SELECT COUNT(*) FROM design_transactions').pluck().get()).toBe(1);
    expect(sqlite.prepare('SELECT COUNT(*) FROM edit_leases').pluck().get()).toBe(1);
    expect(sqlite.prepare('SELECT COUNT(*) FROM reapply_reports').pluck().get()).toBe(1);
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(() => sqlite.prepare("UPDATE design_transactions SET label = 'changed'").run()).toThrow(/append-only/);
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO branches
             (id, game_id, name, git_ref, fork_parent_branch_id, fork_parent_rev, fork_git_sha,
              head_rev, status, created_by, created_at)
           VALUES ('b_2', 'g_1', 'child', 'branch/b_2', 'b_1', 1, NULL,
                   0, 'active', 'u_1', '2026-11-01T16:01:00.000Z')`,
        )
        .run(),
    ).not.toThrow();
    sqlite.close();
  });

  it('backfills the current agreement as revision one', () => {
    const dir = tempDir();
    const migration = '20261102092046_scope_session_revisions.sql';
    for (const file of readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.sql') && file < migration)) {
      copyFileSync(join(MIGRATIONS_DIR, file), join(dir, file));
    }
    const { sqlite } = openDb(':memory:');
    migrate({ sqlite, dir });
    const scope = JSON.stringify({
      session_id: 's_1',
      title: 'Legacy scope',
      summary: 'Already agreed before revisions shipped.',
      scope: { included: ['one room'], excluded: [] },
      tickets: [
        {
          key: 'T1',
          title: 'Build it',
          skills: [],
          dependsOn: [],
          acceptanceCriteria: ['The room exists.'],
        },
      ],
      complexity: 1,
      open_questions: [],
      ideas: [],
    });
    sqlite.exec(`
      INSERT INTO families (id, name, owner_user_id, created_at)
      VALUES ('f_1', 'Family', 'u_1', '2026-11-01T16:00:00.000Z');
      INSERT INTO games (id, family_id, owner_id, title, visibility, repo_visibility, created_at)
      VALUES ('g_1', 'f_1', 'u_1', 'Game', 'private', 'private', '2026-11-01T16:00:00.000Z');
      INSERT INTO jobs
        (id, game_id, branch_id, family_id, creator_id, kind, complexity, state, start, slot,
         plan, reservation, hard_cap_micro_usd, created_at, updated_at)
      VALUES
        ('j_1', 'g_1', 'main', 'f_1', 'u_1', 'scope', 1, 'running', 'now', 'edit',
         '{}', '{}', 1, '2026-11-01T16:00:00.000Z', '2026-11-01T16:00:00.000Z');
    `);
    sqlite
      .prepare(
        `INSERT INTO scope_sessions
          (id, game_id, creator_id, job_id, status, choices, scope, scope_hash, created_at, updated_at)
         VALUES (?, 'g_1', 'u_1', 'j_1', 'agreed', '{}', ?, 'legacy-hash', ?, ?)`,
      )
      .run('s_1', scope, '2026-11-01T16:00:00.000Z', '2026-11-01T16:01:00.000Z');

    copyFileSync(join(MIGRATIONS_DIR, migration), join(dir, migration));
    expect(migrate({ sqlite, dir }).applied).toEqual([migration]);
    expect(sqlite.prepare('SELECT status, revision, scope, scope_hash FROM scope_sessions').get()).toEqual({
      status: 'agreed',
      revision: 1,
      scope,
      scope_hash: 'legacy-hash',
    });
    expect(
      sqlite.prepare('SELECT session_id, revision, scope, scope_hash, agreed_at FROM scope_session_revisions').get(),
    ).toEqual({
      session_id: 's_1',
      revision: 1,
      scope,
      scope_hash: 'legacy-hash',
      agreed_at: '2026-11-01T16:01:00.000Z',
    });
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    sqlite.close();
  });

  it('applies files in name order and ignores files that are not timestamped migrations', () => {
    const dir = tempDir();
    writeFileSync(join(dir, '20261102000000_b.sql'), 'CREATE TABLE b (id INTEGER PRIMARY KEY REFERENCES a(id));');
    writeFileSync(join(dir, '20261101000000_a.sql'), 'CREATE TABLE a (id INTEGER PRIMARY KEY);');
    writeFileSync(join(dir, 'notes.sql'), 'DROP TABLE app_meta;');
    const { sqlite } = openDb(':memory:');
    expect(migrate({ sqlite, dir }).applied).toEqual(['20261101000000_a.sql', '20261102000000_b.sql']);
    sqlite.close();
  });

  it('rolls back and names the file when a migration fails', () => {
    const dir = tempDir();
    writeFileSync(join(dir, '20261101000000_ok.sql'), 'CREATE TABLE ok (id INTEGER);');
    writeFileSync(join(dir, '20261102000000_bad.sql'), 'CREATE TABLE half (id INTEGER); CREATE TABLEX broken;');
    const { sqlite } = openDb(':memory:');
    expect(() => migrate({ sqlite, dir })).toThrow(/20261102000000_bad\.sql/);
    const keys = sqlite.prepare('SELECT key FROM app_meta').pluck().all();
    expect(keys).toEqual(['migration:20261101000000_ok.sql']);
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'half'").get()).toBeUndefined();
    sqlite.close();
  });
});
