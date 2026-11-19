import { expect, it, vi } from 'vitest';
import { schema } from '@ogm/db';
import { createReadyReviewNotifier, startReadyReviewNotifier } from '../../src/review-rounds/ready-notifications.js';
import { answerRound, postRound } from '../../src/review-rounds/store.js';
import { listNotifications } from '../../src/notify/store.js';
import {
  DECISION_ID,
  FAMILY,
  GAME,
  NOW,
  OWNER,
  insertOpenDesignCommand,
  seedDesignGame,
} from '../design-decisions/fixtures.js';
import { makeApp, makeDeps } from '../helpers.js';

it('sends one durable notification per creator for each batch of new rounds and Commands', async () => {
  const deps = makeDeps();
  seedDesignGame(deps);
  const secondGame = 'g_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e99';
  const secondOwner = 'u_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e99';
  deps.db
    .insert(schema.games)
    .values({
      id: secondGame,
      familyId: FAMILY,
      ownerId: secondOwner,
      title: 'Other',
      visibility: 'private',
      repoVisibility: 'private',
      createdAt: NOW,
    })
    .run();
  const row = {
    gameId: GAME,
    track: 'art',
    category: 'art' as const,
    round: 1,
    ticket: '42',
    sha: 'a'.repeat(40),
    media: '[]',
    postedAt: NOW,
  };
  postRound(deps.db, { ...row, id: 'old', phase: 'mock' });
  postRound(deps.db, { ...row, id: 'new', phase: 'build' });
  postRound(deps.db, { ...row, id: 'other', gameId: secondGame, phase: 'mock' });
  let gameCommands = [
    { decision_id: 'd1', version: 1 },
    { decision_id: 'd2', version: 1 },
  ];
  const commands = vi.fn(async (game: { id: string }) => (game.id === GAME ? gameCommands : []));
  const deliver = vi.fn(async () => {});
  const makeNotifier = () =>
    createReadyReviewNotifier(deps, { commands, deliver, now: () => new Date('2026-11-05T00:00:00Z') });
  const notify = makeNotifier();
  await notify();
  expect(deliver).toHaveBeenCalledTimes(2);
  const [first] = listNotifications(deps.sqlite, OWNER, {});
  expect(first).toMatchObject({ kind: 'review.ready', url: '/all' });
  expect(JSON.parse(String(first!.data!.keys))).toEqual([
    `round:${GAME}:new`,
    `command:${GAME}:d1:1`,
    `command:${GAME}:d2:1`,
  ]);
  expect(listNotifications(deps.sqlite, secondOwner, {})).toHaveLength(1);
  await notify();
  await makeNotifier()();
  expect(deliver).toHaveBeenCalledTimes(2);
  gameCommands = [...gameCommands, { decision_id: 'd3', version: 1 }];
  postRound(deps.db, { ...row, id: 'another', phase: 'mock', track: 'other', ticket: '43' });
  await notify();
  expect(deliver).toHaveBeenCalledTimes(3);
  const batches = listNotifications(deps.sqlite, OWNER, {});
  expect(batches).toHaveLength(2);
  expect(batches.map((batch) => JSON.parse(String(batch.data!.keys)))).toContainEqual([
    `round:${GAME}:another`,
    `command:${GAME}:d3:1`,
  ]);
});

it('discovers an open creator Command through the production game inbox', async () => {
  const deps = makeDeps();
  seedDesignGame(deps);
  insertOpenDesignCommand(deps);
  await makeApp(deps);
  const deliver = vi.fn(async () => {});
  await createReadyReviewNotifier(deps, { deliver })();
  expect(deliver).toHaveBeenCalledOnce();
  const [notification] = listNotifications(deps.sqlite, OWNER, {});
  expect(JSON.parse(String(notification!.data!.keys))).toContain(`command:${GAME}:${DECISION_ID}:2`);
});

it('still notifies for rounds when a game command scan fails and retries the scan later', async () => {
  const deps = makeDeps();
  seedDesignGame(deps);
  postRound(deps.db, {
    id: 'round',
    gameId: GAME,
    track: 'art',
    phase: 'mock',
    category: 'art',
    round: 1,
    ticket: '42',
    sha: 'a'.repeat(40),
    media: '[]',
    postedAt: NOW,
  });
  const commands = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce([{ decision_id: 'd', version: 1 }]);
  const deliver = vi.fn(async () => {});
  const notify = createReadyReviewNotifier(deps, { commands, deliver });
  await notify();
  await notify();
  expect(deliver).toHaveBeenCalledTimes(2);
  expect(listNotifications(deps.sqlite, OWNER, {})).toHaveLength(2);
});

it('retries a failed delivery with the same durable notification after restart', async () => {
  const deps = makeDeps();
  seedDesignGame(deps);
  postRound(deps.db, {
    id: 'round',
    gameId: GAME,
    track: 'art',
    phase: 'mock',
    category: 'art',
    round: 1,
    ticket: '42',
    sha: 'a'.repeat(40),
    media: '[]',
    postedAt: NOW,
  });
  const deliver = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
  const makeNotifier = () => createReadyReviewNotifier(deps, { commands: async () => [], deliver });
  await makeNotifier()();
  const first = listNotifications(deps.sqlite, OWNER, {});
  expect(first).toHaveLength(1);
  expect(first[0]?.data?.deliveryPending).toBe(1);
  await makeNotifier()();
  const second = listNotifications(deps.sqlite, OWNER, {});
  expect(second).toHaveLength(1);
  expect(second[0]?.id).toBe(first[0]?.id);
  expect(second[0]?.data?.deliveryPending).toBe(0);
  expect(deliver).toHaveBeenCalledTimes(2);
  expect(deliver.mock.calls[0]?.[0].id).toBe(deliver.mock.calls[1]?.[0].id);
});

it('does not announce a round answered while the Command scan is in flight', async () => {
  const deps = makeDeps();
  seedDesignGame(deps);
  postRound(deps.db, {
    id: 'round',
    gameId: GAME,
    track: 'art',
    phase: 'mock',
    category: 'art',
    round: 1,
    ticket: '42',
    sha: 'a'.repeat(40),
    media: '[]',
    postedAt: NOW,
  });
  const deliver = vi.fn(async () => {});
  const notify = createReadyReviewNotifier(deps, {
    commands: async () => {
      answerRound(deps.db, GAME, 'round', { verdict: 'approved', notes: null, source: 'command', at: NOW });
      return [];
    },
    deliver,
  });
  await notify();
  expect(deliver).not.toHaveBeenCalled();
});

it('does not overlap scans and stops cleanly', async () => {
  vi.useFakeTimers();
  try {
    let finish!: () => void;
    const notify = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const scheduler = startReadyReviewNotifier(notify, 1000, () => {});
    await vi.advanceTimersByTimeAsync(3000);
    expect(notify).toHaveBeenCalledOnce();
    finish();
    await scheduler.idle();
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(3000);
    expect(notify).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});
