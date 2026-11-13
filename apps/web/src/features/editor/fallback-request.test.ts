import { describe, expect, it } from 'vitest';
import { CreateJobRequest } from '@ogm/contracts/browser';

import { fallbackEditRequest } from './fallback-request';

describe('fallback editor request', () => {
  it('turns a palette placement into a game-specific agent job with its asset and preview location', () => {
    const request = fallbackEditRequest(
      { gameId: 'g_00000000-0000-4000-8000-000000000001', branchId: 'main' },
      { assetId: 't3:game/oak-tree', name: 'Oak tree', x: 0.25, y: 0.75 },
      'edit:unique',
    );
    expect(request).toMatchObject({
      gameId: 'g_00000000-0000-4000-8000-000000000001',
      branchId: 'main',
      kind: 'feature',
      start: 'now',
      idempotencyKey: 'edit:unique',
    });
    expect(request.plan.summary).toContain('t3:game/oak-tree');
    expect(request.plan.summary).toContain('0.25');
    expect(request.plan.summary).toContain('0.75');
    expect(request.plan.tickets[0]?.acceptanceCriteria[0]).toBe(request.plan.summary);
    expect(CreateJobRequest.safeParse(request).success).toBe(true);
  });

  it('rejects non-finite or out-of-frame coordinates', () => {
    expect(() =>
      fallbackEditRequest({ gameId: 'g_1', branchId: 'main' }, { assetId: 'tree', name: 'Tree', x: NaN, y: 0 }, 'k'),
    ).toThrow();
    expect(() =>
      fallbackEditRequest({ gameId: 'g_1', branchId: 'main' }, { assetId: 'tree', name: 'Tree', x: 0, y: 2 }, 'k'),
    ).toThrow();
  });

  it('rejects asset identifiers outside the lockfile vocabulary', () => {
    expect(() =>
      fallbackEditRequest({ gameId: 'g_1', branchId: 'main' }, { assetId: '../secret', name: 'Tree', x: 0, y: 0 }, 'k'),
    ).toThrow();
  });
});
