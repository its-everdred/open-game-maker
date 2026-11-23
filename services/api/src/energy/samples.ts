import type { EnergyAdminView, EnergyResource } from '@ogm/contracts';
import { schema, type Db } from '@ogm/db';
import { asc, gte, lt } from 'drizzle-orm';

import { leftPercent } from './resources.js';

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const KEEP_MS = 30 * 24 * HOUR_MS;

// One row per resource for a snapshot, at most once a minute (the provider readings' cache period); rows older
// than 30 days are dropped on the same write.
export function recordSamples(db: Db, resources: EnergyResource[], now: Date): void {
  const latest = db
    .select({ at: schema.energySamples.at })
    .from(schema.energySamples)
    .where(gte(schema.energySamples.at, new Date(now.getTime() - MINUTE_MS).toISOString()))
    .limit(1)
    .get();
  if (latest) return;
  const at = now.toISOString();
  db.transaction((tx) => {
    tx.delete(schema.energySamples)
      .where(lt(schema.energySamples.at, new Date(now.getTime() - KEEP_MS).toISOString()))
      .run();
    if (resources.length === 0) return;
    tx.insert(schema.energySamples)
      .values(
        resources.map((resource) => ({
          resourceId: resource.id,
          at,
          left: leftPercent(resource),
          low: resource.range ? leftPercent(resource, resource.range.low) : null,
          high: resource.range ? leftPercent(resource, resource.range.high) : null,
          basis: resource.basis,
        })),
      )
      .run();
  });
}

// 30 days per resource, the last sample of each hour, oldest first. A missing hour is simply absent.
export function readHistory(db: Db, now: Date): EnergyAdminView['history'] {
  const rows = db
    .select()
    .from(schema.energySamples)
    .where(gte(schema.energySamples.at, new Date(now.getTime() - KEEP_MS).toISOString()))
    .orderBy(asc(schema.energySamples.at))
    .all();
  const byResource = new Map<string, Map<number, (typeof rows)[number]>>();
  for (const row of rows) {
    const hours = byResource.get(row.resourceId) ?? new Map();
    hours.set(Math.floor(Date.parse(row.at) / HOUR_MS), row);
    byResource.set(row.resourceId, hours);
  }
  return [...byResource].map(([id, hours]) => ({
    id,
    points: [...hours.values()].map(({ at, left, low, high, basis }) => ({ at, left, low, high, basis })),
  }));
}
