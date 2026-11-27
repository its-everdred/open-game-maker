import { randomUUID } from 'node:crypto';
import type { Context } from 'hono';
import { schema, type Db } from '@ogm/db';
import { eq } from 'drizzle-orm';
import { HttpError } from '../app/errors.js';
import { hasInternalCredential } from '../app/internal-auth.js';
import type { ApiBindings } from '../app/types.js';
import { readQaState } from './state.js';
import { cleanupEnergyProbeReport } from './energy-report.js';

const KEY = 'qa:energy-probe';
type Lease = { id: string; email: string; previous: { newGames: number | null; edits: number | null } | null };

function lease(db: Db): Lease | null {
  const row = db.select().from(schema.appMeta).where(eq(schema.appMeta.key, KEY)).get();
  return row ? (JSON.parse(row.value) as Lease) : null;
}

// The only affected account is the dedicated QA account. The original value is durable so an interrupted
// probe can be restored by the next operator invocation.
export function activeEnergyProbe(db: Db): { id: string } | null {
  const active = lease(db);
  return active ? { id: active.id } : null;
}

export function energyProbeOwnsEmail(db: Db, email: string): boolean {
  return lease(db)?.email === email;
}

export function beginEnergyProbe(db: Db): Lease {
  return db.transaction((tx) => {
    if (lease(tx)) throw new HttpError(409, 'qa_energy_probe_active');
    const qa = readQaState(tx);
    if (!qa) throw new HttpError(409, 'qa_account_missing');
    const row = tx.select().from(schema.weeklyJobBudgets).where(eq(schema.weeklyJobBudgets.email, qa.email)).get();
    const value: Lease = {
      id: randomUUID(),
      email: qa.email,
      previous: row ? { newGames: row.newGames, edits: row.edits } : null,
    };
    tx.insert(schema.appMeta)
      .values({ key: KEY, value: JSON.stringify(value) })
      .run();
    tx.insert(schema.weeklyJobBudgets)
      .values({ email: qa.email, newGames: 0, edits: 0 })
      .onConflictDoUpdate({ target: schema.weeklyJobBudgets.email, set: { newGames: 0, edits: 0 } })
      .run();
    return value;
  });
}

export function endEnergyProbe(db: Db, id: string): void {
  db.transaction((tx) => {
    const active = lease(tx);
    if (!active || active.id !== id) throw new HttpError(409, 'qa_energy_probe_mismatch');
    cleanupEnergyProbeReport(tx, id);
    if (active.previous)
      tx.insert(schema.weeklyJobBudgets)
        .values({ email: active.email, ...active.previous })
        .onConflictDoUpdate({ target: schema.weeklyJobBudgets.email, set: active.previous })
        .run();
    else tx.delete(schema.weeklyJobBudgets).where(eq(schema.weeklyJobBudgets.email, active.email)).run();
    tx.delete(schema.appMeta).where(eq(schema.appMeta.key, KEY)).run();
  });
}

export function isEnergyProbe(c: Context<ApiBindings>, userId: string): boolean {
  if (!hasInternalCredential(c)) return false;
  const db = c.get('deps').db;
  const qa = readQaState(db);
  // A delayed request must remain fenced even if its lease was restored or recovered meanwhile.
  return !!qa && qa.userId === userId && Boolean(c.req.header('x-ogm-qa-energy-probe'));
}
