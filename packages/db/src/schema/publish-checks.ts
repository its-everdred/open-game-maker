import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { games } from './accounts.js';

/** One attempted publish, including failures that never produced a build. */
export const publishChecks = sqliteTable(
  'publish_checks',
  {
    id: text('id').primaryKey(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    gitSha: text('git_sha').notNull(),
    buildId: text('build_id'),
    surface: text('surface', { enum: ['game', 'app'] }).notNull(),
    sizesJson: text('sizes_json').notNull(),
    checksJson: text('checks_json').notNull(),
    result: text('result', { enum: ['passed', 'failed'] }).notNull(),
    publishResult: text('publish_result', { enum: ['pending', 'published', 'skipped', 'failed'] })
      .notNull()
      .default('pending'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('publish_checks_game_index').on(table.gameId, table.createdAt)],
);
