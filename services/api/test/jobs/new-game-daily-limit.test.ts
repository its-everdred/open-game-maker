import { describe, expect, it } from 'vitest';
import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';

import { admit } from '../../src/jobs/admission.js';
import { newGameDailyUsage } from '../../src/jobs/new-game-daily-limit.js';
import { ids, insertJob, NOW, plan, RESETS_AT, worked, ZONE } from '../budget/fixture.js';

const actor = { userId: ids.creator, familyId: ids.family, platformRole: 'none', capability: 'creator' } as const;
const request = { gameId: ids.game, branchId: 'main', kind: 'new_game', complexity: 1, plan, start: 'now' } as const;
const otherGame = 'g_other_daily';
function seedOther(deps: ReturnType<typeof worked>) {
  deps.db
    .insert(schema.games)
    .values({
      id: otherGame,
      familyId: ids.family,
      ownerId: ids.creator,
      title: 'Other',
      visibility: 'private',
      repoVisibility: 'private',
      createdAt: '2026-10-30T12:00:00.000Z',
    })
    .run();
}

describe('new-game daily limit', () => {
  it('admits only one concurrent request at the daily limit', async () => {
    const deps = worked();
    seedOther(deps);
    deps.db
      .update(schema.games)
      .set({ createdAt: '2026-10-30T12:00:00.000Z' })
      .where(eq(schema.games.id, ids.game))
      .run();
    const admission = {
      db: deps.db,
      sqlite: deps.sqlite,
      events: deps.events,
      defaults: { dailyAllowanceMicroUsd: 20_000_000, resetZone: ZONE },
      newGameDailyLimit: 1,
      now: () => NOW,
    };
    const results = await Promise.allSettled([
      admit(admission, request, actor),
      admit(admission, { ...request, gameId: otherGame }, actor),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    deps.sqlite.close();
  });

  it('enforces the limit atomically per creator and preserves idempotent retries', async () => {
    const deps = worked();
    seedOther(deps);
    const admission = {
      db: deps.db,
      sqlite: deps.sqlite,
      events: deps.events,
      defaults: { dailyAllowanceMicroUsd: 20_000_000, resetZone: ZONE },
      newGameDailyLimit: 1,
      now: () => NOW,
    };
    const first = { ...request, idempotencyKey: 'first' };
    const created = await admit(admission, first, actor);
    await expect(admit(admission, first, actor)).resolves.toMatchObject({ jobId: created.jobId, reused: true });
    await expect(admit(admission, request, actor)).resolves.toMatchObject({ jobId: expect.any(String) });
    await expect(admit(admission, { ...request, gameId: otherGame }, actor)).rejects.toMatchObject({
      body: { error: 'energy_limit_reached', window: 'day', resetsAt: RESETS_AT },
    });
    expect(newGameDailyUsage(deps.db, ids.other, NOW, ZONE).count).toBe(0);
    deps.sqlite.close();
  });

  it('counts the whole 25-hour local day across the daylight-saving transition', () => {
    const deps = worked();
    seedOther(deps);
    for (const [id, at, gameId] of [
      ['j_early', '2026-11-01T07:30:00.000Z', ids.game],
      ['j_late', '2026-11-02T07:30:00.000Z', otherGame],
      ['j_previous', '2026-11-01T06:59:00.000Z', ids.game],
    ]) {
      insertJob(deps, { id, gameId, kind: 'new_game', createdAt: at, updatedAt: at });
    }
    expect(newGameDailyUsage(deps.db, ids.creator, new Date('2026-11-02T07:45:00.000Z'), ZONE)).toMatchObject({
      count: 2,
      resetsAt: '2026-11-02T08:00:00.000Z',
    });
    deps.sqlite.close();
  });
});
