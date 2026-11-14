import { eq } from 'drizzle-orm';
import { schema, type Db } from '@ogm/db';

const KEY = 'review_rounds:last_reconcile_at';

export function recordReconcileHeartbeat(db: Db, at: number): void {
  db.insert(schema.appMeta)
    .values({ key: KEY, value: String(at) })
    .onConflictDoUpdate({ target: schema.appMeta.key, set: { value: String(at) } })
    .run();
}

export function reconcileStale(db: Db, now: number, intervalMs: number): boolean {
  const row = db.select().from(schema.appMeta).where(eq(schema.appMeta.key, KEY)).get();
  const at = row ? Number(row.value) : NaN;
  return !Number.isFinite(at) || now - at >= intervalMs * 2;
}
