import { schema, type Db } from '@ogm/db';
import { and, eq } from 'drizzle-orm';
import { readQaState } from './state.js';

// Only the dedicated QA account's exact probe marker is removable. A random id in the frame makes its
// signature unique; never delete a signature still referenced by any other report.
export function cleanupEnergyProbeReport(db: Db, id: string): void {
  const qa = readQaState(db);
  if (!qa) return;
  db.transaction((tx) => {
    const filter = and(
      eq(schema.reports.reporterId, qa.userId),
      eq(schema.reports.gameId, qa.gameId),
      eq(schema.reports.text, `qa-energy-probe:${id}`),
    );
    const rows = tx.select({ signature: schema.reports.signature }).from(schema.reports).where(filter).all();
    tx.delete(schema.reports).where(filter).run();
    for (const { signature } of rows) {
      const remaining = tx
        .select({ id: schema.reports.id })
        .from(schema.reports)
        .where(eq(schema.reports.signature, signature))
        .get();
      if (!remaining)
        tx.delete(schema.reportSignatures)
          .where(and(eq(schema.reportSignatures.signature, signature), eq(schema.reportSignatures.gameId, qa.gameId)))
          .run();
    }
  });
}
