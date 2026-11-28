import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { games } from './accounts.js';

/** Numbers consumed before remote tag creation, including attempts interrupted before their release was saved. */
export const releaseTagReservations = sqliteTable(
  'release_tag_reservations',
  {
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
  },
  (table) => [uniqueIndex('release_tag_reservations_game_number_unique').on(table.gameId, table.number)],
);
