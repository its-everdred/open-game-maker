import { sql } from 'drizzle-orm';
import { check, index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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

// Caps an admin sets for a provider (#1219): the Netlify credit allotment and subscription plan fees. Keyed by the
// cap id the dashboard shows; null is "not set".
export const energyCaps = sqliteTable(
  'energy_caps',
  {
    id: text('id').primaryKey(),
    limit: real('limit'),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [check('energy_caps_value', sql`coalesce(${table.limit}, 0) >= 0`)],
);

// One row per resource per Energy snapshot (at most one snapshot a minute), kept 30 days, for the admin history.
// `left`, `low` and `high` are percent of the limit left; null is unknown and draws as a gap.
export const energySamples = sqliteTable(
  'energy_samples',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    resourceId: text('resource_id').notNull(),
    at: text('at').notNull(),
    left: real('left'),
    low: real('low'),
    high: real('high'),
    basis: text('basis', { enum: ['reported', 'estimate', 'unknown'] }).notNull(),
  },
  (table) => [index('energy_samples_at').on(table.at)],
);
