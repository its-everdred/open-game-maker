import { sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { games } from './accounts.js';
import { reviewRounds } from './review-rounds.js';

// The first owner may be seeded from Git; later owners are assigned as approval creates their tickets.
export const reviewPhaseOwners = sqliteTable(
  'review_phase_owners',
  {
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    track: text('track').notNull(),
    phase: text('phase').notNull(),
    ticket: text('ticket').notNull(),
    sourceRoundId: text('source_round_id').references(() => reviewRounds.id),
  },
  (table) => [uniqueIndex('review_phase_owners_phase').on(table.gameId, table.track, table.phase)],
);
