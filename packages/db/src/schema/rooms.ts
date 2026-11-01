import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { games, invitations } from './accounts.js';

export const rooms = sqliteTable(
  'rooms',
  {
    id: text('id').primaryKey(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    branchId: text('branch_id').notNull(),
    buildId: text('build_id').notNull(),
    ownerId: text('owner_id').notNull(),
    maxPlayers: integer('max_players').notNull(),
    createdAt: text('created_at').notNull(),
    endedAt: text('ended_at'),
    endReason: text('end_reason'),
  },
  (table) => [
    index('rooms_game_branch_open_index').on(table.gameId, table.branchId, table.endedAt),
    index('rooms_owner_id_index').on(table.ownerId),
    check('rooms_max_players_check', sql`${table.maxPlayers} BETWEEN 1 AND 8`),
  ],
);

export const roomMembers = sqliteTable(
  'room_members',
  {
    roomId: text('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    invitationId: text('invitation_id').references(() => invitations.id),
    joinedAt: text('joined_at').notNull(),
    revokedAt: text('revoked_at'),
  },
  (table) => [
    primaryKey({ columns: [table.roomId, table.userId] }),
    index('room_members_user_id_index').on(table.userId),
  ],
);
