import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Operator telemetry from the app shell: app opens, play heartbeats and crashes. No FK on game_id:
// a crash row must outlive the game it names. `detail_json` holds the kind's own fields.
export const clientEvents = sqliteTable(
  'client_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    receivedAt: text('received_at').notNull(),
    at: text('at').notNull(),
    kind: text('kind', { enum: ['app_open', 'session_end', 'first_frame', 'in_world', 'crash'] }).notNull(),
    userId: text('user_id').notNull(),
    sessionId: text('session_id').notNull(),
    origin: text('origin').notNull(),
    appVersion: text('app_version').notNull(),
    device: text('device').notNull(),
    gameId: text('game_id'),
    buildId: text('build_id'),
    signature: text('signature'),
    detailJson: text('detail_json').notNull(),
  },
  (table) => [
    index('client_events_received_idx').on(table.receivedAt),
    index('client_events_game_build_idx').on(table.gameId, table.buildId, table.kind),
  ],
);

// One row per (game, build, error signature). Empty strings stand for "no game" / "no build".
export const crashGroups = sqliteTable(
  'crash_groups',
  {
    gameId: text('game_id').notNull(),
    buildId: text('build_id').notNull(),
    signature: text('signature').notNull(),
    crash: text('crash').notNull(),
    message: text('message').notNull(),
    count: integer('count').notNull(),
    firstSeenAt: text('first_seen_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    firstEventId: integer('first_event_id').notNull(),
    lastEventId: integer('last_event_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.gameId, table.buildId, table.signature] }),
    index('crash_groups_first_event_idx').on(table.firstEventId),
  ],
);
