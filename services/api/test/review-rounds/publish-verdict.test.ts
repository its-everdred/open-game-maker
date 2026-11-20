import { eq } from 'drizzle-orm';
import { schema } from '@ogm/db';
import { expect, it, vi } from 'vitest';
import { dispatchPublishedPrototypeVerdict } from '../../src/review-rounds/publish-verdict.js';
import { answerRound, postRound } from '../../src/review-rounds/store.js';
import { GAME, seedDesignGame } from '../design-decisions/fixtures.js';
import { makeDeps } from '../helpers.js';

it('fans a publish verdict to each source ticket and waits for each worker run once', async () => {
  const deps = makeDeps();
  seedDesignGame(deps);
  postRound(deps.db, {
    id: 'publish-round',
    gameId: GAME,
    track: 'prototype-publish',
    phase: 'build',
    category: 'gameplay',
    round: 1,
    ticket: '42',
    sha: 'a'.repeat(40),
    media: '[{"kind":"build","ref":"build-1"}]',
    sourceTickets: '["42","43"]',
    postedAt: '2026-01-01T00:00:00Z',
  });
  answerRound(deps.db, GAME, 'publish-round', {
    verdict: 'needs_work',
    notes: 'please add attacking',
    source: 'command',
    at: '2026-01-01T01:00:00Z',
  });
  const round = deps.db.select().from(schema.reviewRounds).where(eq(schema.reviewRounds.id, 'publish-round')).get()!;
  const markers = new Map<string, { runId: string | null }>();
  const delivery = {
    findMarker: vi.fn(async (ticket: string, marker: string) => markers.get(`${ticket}:${marker}`) ?? null),
    rework: vi.fn(async (ticket: string, reason: string) => {
      const marker = /<!-- gm-review-verdict:([^ ]+) -->/u.exec(reason)?.[0];
      expect(marker).toBeTruthy();
      markers.set(`${ticket}:${marker}:${ticket}`, { runId: null });
    }),
  };
  const sync = () => dispatchPublishedPrototypeVerdict(deps.db, round, delivery, () => '2026-01-01T02:00:00Z');

  await sync();
  expect(delivery.rework).toHaveBeenCalledTimes(2);
  expect(
    deps.db.select().from(schema.reviewRounds).where(eq(schema.reviewRounds.id, round.id)).get()?.consumedByRun,
  ).toBeNull();
  await sync();
  expect(delivery.rework).toHaveBeenCalledTimes(2);
  for (const [key] of markers) markers.set(key, { runId: 'worker-run' });
  await sync();

  expect(
    deps.db.select().from(schema.reviewRounds).where(eq(schema.reviewRounds.id, round.id)).get()?.consumedByRun,
  ).toContain('worker-run');
  expect(
    deps.db.select().from(schema.reviewDispatchIntents).where(eq(schema.reviewDispatchIntents.roundId, round.id)).get()
      ?.state,
  ).toBe('consumed');
});

it('settles a delivered marker after its ticket has no pending work to consume it', async () => {
  const deps = makeDeps();
  seedDesignGame(deps);
  postRound(deps.db, {
    id: 'publish-round-idle',
    gameId: GAME,
    track: 'prototype-publish',
    phase: 'build',
    category: 'gameplay',
    round: 1,
    ticket: '42',
    sha: 'a'.repeat(40),
    media: '[{"kind":"build","ref":"build-1"}]',
    sourceTickets: '["42"]',
    postedAt: '2026-01-01T00:00:00Z',
  });
  answerRound(deps.db, GAME, 'publish-round-idle', {
    verdict: 'needs_work',
    notes: 'please add attacking',
    source: 'command',
    at: '2026-01-01T01:00:00Z',
  });
  const round = deps.db
    .select()
    .from(schema.reviewRounds)
    .where(eq(schema.reviewRounds.id, 'publish-round-idle'))
    .get()!;
  const delivery = {
    findMarker: vi.fn(async () => ({ runId: null, pending: false })),
    rework: vi.fn(),
  };

  await dispatchPublishedPrototypeVerdict(deps.db, round, delivery, () => '2026-01-01T02:00:00Z');

  expect(delivery.rework).not.toHaveBeenCalled();
  expect(
    deps.db.select().from(schema.reviewRounds).where(eq(schema.reviewRounds.id, round.id)).get()?.consumedByRun,
  ).toBe(`publish-review:${round.id}`);
  expect(
    deps.db.select().from(schema.reviewDispatchIntents).where(eq(schema.reviewDispatchIntents.roundId, round.id)).get()
      ?.state,
  ).toBe('consumed');
});
