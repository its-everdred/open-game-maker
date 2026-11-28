import { describe, expect, it, vi } from 'vitest';

import type { AgreedScope } from '@ogm/contracts';

import { admissionRefusal, admitNewGame } from './admit';

const scope: AgreedScope = {
  session_id: 's_1',
  revision: 1,
  title: 'Midnight Crumbs',
  summary: 'A night bakery delivery game.',
  scope: { included: ['three islands'], excluded: ['online multiplayer'] },
  tickets: [
    {
      key: 'game',
      title: 'Build the game',
      skills: [],
      dependsOn: [],
      acceptanceCriteria: ['The first delivery is playable.'],
    },
  ],
  complexity: 2,
  open_questions: [],
  ideas: [],
};

describe('admitNewGame', () => {
  it('maps a game-provisioning limit into the same refusal shown for job admission', () => {
    expect(
      admissionRefusal({
        status: 402,
        body: {
          error: 'energy_limit_reached',
          remainingMicroUsd: 0,
          resetsAt: '2026-11-28T08:00:00.000Z',
          offers: ['ask_admin'],
          window: 'day',
        },
      }),
    ).toMatchObject({ kind: 'refused', offers: ['ask_admin'], window: 'day' });
    expect(admissionRefusal({ status: 503 })).toBeNull();
  });
  it('uses the agreed scope unchanged and navigates after admission', async () => {
    const request = vi.fn().mockResolvedValue({ jobId: 'j_1', state: 'admitted' });
    const navigate = vi.fn();

    const result = await admitNewGame(
      { gameId: 'g_1', sessionId: 's_1', scope, attempt: 1, start: 'now' },
      { request, navigate },
    );

    expect(request).toHaveBeenCalledWith('/jobs', {
      method: 'POST',
      json: {
        gameId: 'g_1',
        branchId: 'main',
        kind: 'new_game',
        complexity: 2,
        plan: {
          title: scope.title,
          summary: scope.summary,
          scope: scope.scope,
          tickets: scope.tickets.map(({ key, skills, dependsOn, acceptanceCriteria }) => ({
            key,
            skills,
            dependsOn,
            acceptanceCriteria,
          })),
        },
        start: 'now',
        idempotencyKey: 'scope:s_1:1',
      },
    });
    expect(navigate).toHaveBeenCalledWith('/games?spotlight=g_1');
    expect(result).toEqual({ kind: 'accepted', jobId: 'j_1' });
  });

  it('returns only the offers named by a 402 response', async () => {
    const request = vi.fn().mockRejectedValue({
      status: 402,
      body: {
        error: 'allowance_exceeded',
        remainingMicroUsd: 1200000,
        resetsAt: '2026-11-02T07:00:00.000Z',
        offers: ['trim', 'queue'],
      },
    });

    await expect(
      admitNewGame(
        { gameId: 'g_1', sessionId: 's_1', scope, attempt: 1, start: 'now' },
        { request, navigate: vi.fn() },
      ),
    ).resolves.toMatchObject({ kind: 'refused', offers: ['queue'] });
  });

  it('queues the same plan at reset with the next idempotency suffix', async () => {
    const request = vi.fn().mockResolvedValue({ jobId: 'j_2', state: 'queued' });
    const navigate = vi.fn();

    await admitNewGame(
      { gameId: 'g_1', sessionId: 's_1', scope, attempt: 2, start: 'at_reset' },
      { request, navigate },
    );

    expect(request).toHaveBeenCalledWith(
      '/jobs',
      expect.objectContaining({
        json: expect.objectContaining({ start: 'at_reset', idempotencyKey: 'scope:s_1:2' }),
      }),
    );
    expect(navigate).toHaveBeenCalledWith('/games?spotlight=g_1');
  });
});
