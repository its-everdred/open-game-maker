import type { EnergyLimits, EnergyPreference } from '@ogm/contracts';
import { schema, type Db } from '@ogm/db';
import { eq } from 'drizzle-orm';

const INSTANCE = 'instance';

export function readLimits(db: Db): EnergyLimits {
  const row = db.select().from(schema.energyLimits).where(eq(schema.energyLimits.id, INSTANCE)).get();
  return {
    day: row?.dayMicroUsd ?? null,
    week: row?.weekMicroUsd ?? null,
    month: row?.monthMicroUsd ?? null,
    voice: row?.voiceMicroUsd ?? null,
    images: row?.imagesMicroUsd ?? null,
  };
}

export function writeLimits(db: Db, limits: EnergyLimits, now: Date): void {
  const values = {
    dayMicroUsd: limits.day,
    weekMicroUsd: limits.week,
    monthMicroUsd: limits.month,
    voiceMicroUsd: limits.voice,
    imagesMicroUsd: limits.images,
    updatedAt: now.toISOString(),
  };
  db.insert(schema.energyLimits)
    .values({ id: INSTANCE, ...values })
    .onConflictDoUpdate({ target: schema.energyLimits.id, set: values })
    .run();
}

export function readPreference(db: Db, userId: string): EnergyPreference {
  return (
    db
      .select({ preference: schema.energyPreferences.preference })
      .from(schema.energyPreferences)
      .where(eq(schema.energyPreferences.userId, userId))
      .get()?.preference ?? 'balanced'
  );
}

export function writePreference(db: Db, userId: string, preference: EnergyPreference, now: Date): void {
  const values = { preference, updatedAt: now.toISOString() };
  db.insert(schema.energyPreferences)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: schema.energyPreferences.userId, set: values })
    .run();
}
