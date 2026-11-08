import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Energy (#598): the hosted instance's admin-entered ceilings, one row. A null column is "no limit set".
export const energyLimits = sqliteTable(
  'energy_limits',
  {
    id: text('id').primaryKey(),
    dayMicroUsd: integer('day_micro_usd'),
    weekMicroUsd: integer('week_micro_usd'),
    monthMicroUsd: integer('month_micro_usd'),
    voiceMicroUsd: integer('voice_micro_usd'),
    imagesMicroUsd: integer('images_micro_usd'),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    check('energy_limits_singleton', sql`${table.id} = 'instance'`),
    check(
      'energy_limits_values',
      sql`coalesce(${table.dayMicroUsd}, 0) >= 0 AND coalesce(${table.weekMicroUsd}, 0) >= 0 AND coalesce(${table.monthMicroUsd}, 0) >= 0 AND coalesce(${table.voiceMicroUsd}, 0) >= 0 AND coalesce(${table.imagesMicroUsd}, 0) >= 0`,
    ),
  ],
);

export const energyPreferences = sqliteTable(
  'energy_preferences',
  {
    userId: text('user_id').primaryKey(),
    preference: text('preference', { enum: ['save', 'balanced', 'best'] }).notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [check('energy_preferences_value', sql`${table.preference} IN ('save', 'balanced', 'best')`)],
);
