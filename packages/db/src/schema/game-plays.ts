import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { games } from './accounts.js';

export const gamePlays = sqliteTable(
  'game_plays',
  {
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    lastPlayedAt: text('last_played_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.gameId, table.userId] })],
);

// Retry IDs expire after one day; totals remain after their IDs are pruned.
export const gamePlaySessions = sqliteTable(
  'game_play_sessions',
  {
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    userId: text('user_id').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.gameId, table.id] }),
    index('game_play_sessions_created_idx').on(table.createdAt),
    index('game_play_sessions_user_idx').on(table.gameId, table.userId, table.createdAt),
  ],
);

export const gamePlayTotals = sqliteTable('game_play_totals', {
  gameId: text('game_id')
    .primaryKey()
    .references(() => games.id, { onDelete: 'cascade' }),
  plays: integer('plays').notNull().default(0),
});
