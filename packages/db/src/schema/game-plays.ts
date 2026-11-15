import { primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
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
