import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { games } from './accounts.js';
import { branches } from './design.js';

export const builds = sqliteTable(
  'builds',
  {
    id: text('id').primaryKey(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    gitSha: text('git_sha').notNull(),
    jobId: text('job_id'),
    sdkVersion: text('sdk_version').notNull(),
    saveSchemaVersion: integer('save_schema_version').notNull(),
    migratesFromSchema: integer('migrates_from_schema'),
    achievementCatalogHash: text('achievement_catalog_hash').notNull(),
    status: text('status', { enum: ['building', 'tested', 'failed'] }).notNull(),
    prototypeReviewState: text('prototype_review_state', { enum: ['pending', 'posted', 'none'] })
      .notNull()
      .default('none'),
    artifact: text('artifact', { enum: ['present', 'gc'] }).notNull(),
    artifactPath: text('artifact_path').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('builds_game_branch_index').on(table.gameId, table.branchId),
    check('builds_save_schema_version_check', sql`${table.saveSchemaVersion} >= 0`),
    check(
      'builds_migrates_from_schema_check',
      sql`${table.migratesFromSchema} IS NULL OR ${table.migratesFromSchema} >= 0`,
    ),
    check('builds_status_check', sql`${table.status} IN ('building', 'tested', 'failed')`),
    check('builds_prototype_review_state_check', sql`${table.prototypeReviewState} IN ('pending', 'posted', 'none')`),
    check('builds_artifact_check', sql`${table.artifact} IN ('present', 'gc')`),
  ],
);

export const overrideSnapshots = sqliteTable(
  'override_snapshots',
  {
    id: text('id').primaryKey(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    buildId: text('build_id')
      .notNull()
      .references(() => builds.id),
    headRev: integer('head_rev').notNull(),
    sha256: text('sha256').notNull(),
    entriesJson: text('entries_json').notNull(),
    entityOpsJson: text('entity_ops_json').notNull(),
    foldSha: text('fold_sha'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('override_snapshots_game_build_hash_rev_unique').on(
      table.gameId,
      table.buildId,
      table.sha256,
      table.headRev,
    ),
    index('override_snapshots_game_index').on(table.gameId),
    check('override_snapshots_head_rev_check', sql`${table.headRev} >= 0`),
  ],
);

export const releases = sqliteTable(
  'releases',
  {
    id: text('id').primaryKey(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    version: text('version').notNull(),
    buildId: text('build_id')
      .notNull()
      .references(() => builds.id),
    snapshotId: text('snapshot_id')
      .notNull()
      .references(() => overrideSnapshots.id),
    gitTag: text('git_tag').notNull(),
    kind: text('kind', { enum: ['publish', 'rollback'] }).notNull(),
    restoresReleaseId: text('restores_release_id'),
    predecessorReleaseId: text('predecessor_release_id'),
    changelogJson: text('changelog_json').notNull(),
    publishedBy: text('published_by').notNull(),
    publishedAt: text('published_at').notNull(),
  },
  (table) => [
    uniqueIndex('releases_game_seq_unique').on(table.gameId, table.seq),
    uniqueIndex('releases_git_tag_unique').on(table.gitTag),
    index('releases_game_published_index').on(table.gameId, table.publishedAt),
    check('releases_seq_check', sql`${table.seq} > 0`),
    check('releases_kind_check', sql`${table.kind} IN ('publish', 'rollback')`),
  ],
);

export const changeNotes = sqliteTable(
  'change_notes',
  {
    id: text('id').primaryKey(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    jobId: text('job_id'),
    txId: text('tx_id'),
    kind: text('kind', { enum: ['fix', 'add', 'change', 'remove'] }).notNull(),
    text: text('text').notNull(),
    releaseId: text('release_id').references(() => releases.id),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('change_notes_game_release_index').on(table.gameId, table.releaseId),
    check('change_notes_kind_check', sql`${table.kind} IN ('fix', 'add', 'change', 'remove')`),
  ],
);
