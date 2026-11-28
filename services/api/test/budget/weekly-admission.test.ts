import { schema } from '@ogm/db';
import { describe, expect, it } from 'vitest';

import { admit, AdmissionRefused } from '../../src/jobs/admission.js';
import { ids, NOW, plan, worked, ZONE } from './fixture.js';

describe('weekly admission', () => {
  it.each(['new_game', 'feature', 'repair', 'scope'] as const)(
    'refuses %s when its weekly budget is empty',
    async (kind) => {
      const deps = worked();
      const date = new Date();
      deps.db
        .insert(schema.user)
        .values({
          id: ids.creator,
          name: 'Tester',
          email: 'tester@example.test',
          emailVerified: true,
          createdAt: date,
          updatedAt: date,
        })
        .run();
      deps.db
        .insert(schema.allowedUsers)
        .values({ email: 'tester@example.test', role: 'maker', addedBy: 'env', addedAt: date.toISOString() })
        .run();
      deps.db.insert(schema.weeklyJobBudgets).values({ email: 'tester@example.test', newGames: 0, edits: 0 }).run();
      const actor = { userId: ids.creator, familyId: ids.family, platformRole: 'none', capability: 'creator' } as const;
      const request = { gameId: ids.game, branchId: 'main', kind, complexity: 1, plan, start: 'now' } as const;
      try {
        await admit(
          {
            db: deps.db,
            sqlite: deps.sqlite,
            events: deps.events,
            defaults: { dailyAllowanceMicroUsd: 20_000_000, resetZone: ZONE },
            now: () => NOW,
          },
          request,
          actor,
        );
        throw new Error('expected refusal');
      } catch (error) {
        expect(error).toBeInstanceOf(AdmissionRefused);
        expect((error as AdmissionRefused).body).toMatchObject({
          error: 'energy_limit_reached',
          window: 'week',
          resetsAt: '2026-11-02T08:00:00.000Z',
        });
      }
    },
  );
  it.each(['new_game', 'feature'] as const)('admits a fresh %s without an implicit daily cost cap', async (kind) => {
    const deps = worked();
    const actor = { userId: ids.creator, familyId: ids.family, platformRole: 'none', capability: 'creator' } as const;
    const request = { gameId: ids.game, branchId: 'main', kind, complexity: 5, plan, start: 'now' } as const;
    const admission = {
      db: deps.db,
      sqlite: deps.sqlite,
      events: deps.events,
      defaults: { dailyAllowanceMicroUsd: 5_000_000, resetZone: ZONE },
      now: () => NOW,
    };
    await expect(admit(admission, request, actor)).resolves.toMatchObject({ jobId: expect.any(String) });
  });

  it('retains an operator-configured default daily allowance without a user row', async () => {
    const deps = worked();
    const actor = { userId: ids.creator, familyId: ids.family, platformRole: 'none', capability: 'creator' } as const;
    const request = {
      gameId: ids.game,
      branchId: 'main',
      kind: 'new_game',
      complexity: 1,
      plan,
      start: 'now',
    } as const;
    const admission = {
      db: deps.db,
      sqlite: deps.sqlite,
      events: deps.events,
      defaults: { dailyAllowanceMicroUsd: 5_000_000, defaultAllowanceConfigured: true, resetZone: ZONE },
      now: () => NOW,
    };
    await expect(admit(admission, request, actor)).rejects.toMatchObject({ body: { error: 'allowance_exceeded' } });
  });

  it('retains an explicitly configured family cost cap', async () => {
    const deps = worked();
    deps.db
      .insert(schema.familyBudgetSettings)
      .values({
        familyId: ids.family,
        resetZone: ZONE,
        unitLabel: 'Energy',
        microUsdPerUnit: 100_000,
        platformCapMicroUsd: 5_000_000,
        slotsNewGame: 1,
        slotsEdit: 3,
        hardCapMultiplier: 1,
      })
      .run();
    const actor = { userId: ids.creator, familyId: ids.family, platformRole: 'none', capability: 'creator' } as const;
    const request = {
      gameId: ids.game,
      branchId: 'main',
      kind: 'new_game',
      complexity: 1,
      plan,
      start: 'now',
    } as const;
    const admission = {
      db: deps.db,
      sqlite: deps.sqlite,
      events: deps.events,
      defaults: { dailyAllowanceMicroUsd: 5_000_000, resetZone: ZONE },
      now: () => NOW,
    };
    await expect(admit(admission, request, actor)).rejects.toMatchObject({ body: { error: 'platform_cap_reached' } });
  });

  it('admits only one concurrent new-game job at the final weekly unit', async () => {
    const deps = worked();
    const date = new Date();
    deps.db
      .insert(schema.user)
      .values({
        id: ids.creator,
        name: 'Tester',
        email: 'tester@example.test',
        emailVerified: true,
        createdAt: date,
        updatedAt: date,
      })
      .run();
    deps.db
      .insert(schema.allowedUsers)
      .values({ email: 'tester@example.test', role: 'maker', addedBy: 'env', addedAt: date.toISOString() })
      .run();
    deps.db.insert(schema.weeklyJobBudgets).values({ email: 'tester@example.test', newGames: 1, edits: 20 }).run();
    const actor = { userId: ids.creator, familyId: ids.family, platformRole: 'none', capability: 'creator' } as const;
    const request = {
      gameId: ids.game,
      branchId: 'main',
      kind: 'new_game',
      complexity: 1,
      plan,
      start: 'now',
    } as const;
    const admission = {
      db: deps.db,
      sqlite: deps.sqlite,
      events: deps.events,
      defaults: { dailyAllowanceMicroUsd: 20_000_000, resetZone: ZONE },
      now: () => NOW,
    };
    const results = await Promise.allSettled([admit(admission, request, actor), admit(admission, request, actor)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const refusal = results.find((result) => result.status === 'rejected');
    expect(refusal?.reason).toMatchObject({ body: { reason: 'weekly_user' } });
  });
});
