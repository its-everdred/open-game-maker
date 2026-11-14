import { expect, it } from 'vitest';
import { reconcileStale, recordReconcileHeartbeat } from '../../src/review-rounds/heartbeat.js';
import { makeDeps } from '../helpers.js';

it('reports a missing or stopped reconciler within two intervals', () => {
  const { db } = makeDeps();
  expect(reconcileStale(db, 10000, 1000)).toBe(true);
  recordReconcileHeartbeat(db, 10000);
  expect(reconcileStale(db, 11999, 1000)).toBe(false);
  expect(reconcileStale(db, 12000, 1000)).toBe(true);
  recordReconcileHeartbeat(db, 12000);
  expect(reconcileStale(db, 12000, 1000)).toBe(false);
});
