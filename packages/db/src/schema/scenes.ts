import { sql } from 'drizzle-orm';
import { check, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { games } from './accounts.js';

/**
 * The shared scene documents (#1207's head and revision log, #1209): the map maker saves the creator's edits here and
 * `gm scene pull`/`push` sync agents through it. `doc` and `revision` are canonical JSON (`SceneDoc`, `SceneRevision`).
 */
export const sceneHeads = sqliteTable(
  'scene_heads',
  {
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    scene: text('scene').notNull(),
    rev: integer('rev').notNull(),
    doc: text('doc').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.gameId, table.scene] }),
    check('scene_heads_rev_check', sql`${table.rev} >= 0`),
  ],
);

export const sceneRevisions = sqliteTable(
  'scene_revisions',
  {
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    scene: text('scene').notNull(),
    rev: integer('rev').notNull(),
    revision: text('revision').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.gameId, table.scene, table.rev] }),
    check('scene_revisions_rev_check', sql`${table.rev} >= 1`),
  ],
);
