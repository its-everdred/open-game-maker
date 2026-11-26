import { AiurHttpError, type AiurClient } from '@ogm/aiur-client';
import { describe, expect, it, vi } from 'vitest';

import { createExecutorNotifier } from '../src/executor-thread/notify.js';
import { listNotifications } from '../src/notify/store.js';
import { makeDeps } from './helpers.js';

// aiur's `operator.notify.<kind>` (aiur-team/aiur#8034) is mocked until it ships: `{title, body, ticket, url, created_at}`.
const OWNER = 'u_85400000-0000-4000-8000-000000000001';
const NOW = new Date('2026-11-18T06:00:00.000Z');

function notice(seq: number, kind: string, createdAt = '2026-11-18T05:59:00.000Z') {
  return {
    type: 'event' as const,
    seq,
    v: 1 as const,
    instance: 'core',
    id: 1000 + seq,
    topic: `operator.notify.${kind}`,
    class: 'logged' as const,
    occurred_at: createdAt,
    observed_at: createdAt,
    source: 'cli',
    refs: {},
    attrs: {},
    payload: { title: `Blobs ${kind}`, body: 'Versus CPU results screen', ticket: 645, created_at: createdAt },
    payload_version: 1,
    anchor: null,
  };
}

function page(records: unknown[], head = 10) {
  return { records, oldest_seq: 1, head_seq: head, epoch: 'e', instance: 'core' };
}

function setup(pages: unknown[], head = 10) {
  const deps = makeDeps();
  deps.config.instanceOwnerId = OWNER;
  const events = vi.fn(async (_after: number, limit: number) =>
    limit === 1 ? page([], head) : (pages.shift() ?? page([], head)),
  );
  deps.registry.coreAiurClient = { events } as unknown as AiurClient;
  const deliver = vi.fn(async () => undefined);
  return { deps, events, deliver, notify: createExecutorNotifier(deps, { deliver, now: () => NOW }) };
}

describe('executor notices', () => {
  // Notify (#854): each "live", "review ready" or "stalled" reaches the owner's phone exactly once.
  it('pushes each notice once to the instance owner', async () => {
    const live = notice(9, 'live');
    const { deps, deliver, notify } = setup([page([live, notice(10, 'stalled')]), page([live])]);
    await notify();
    await notify();
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(deliver.mock.calls.map(([n]) => (n as { title: string }).title)).toEqual(['Blobs live', 'Blobs stalled']);
    const stored = listNotifications(deps.sqlite, OWNER, { unread: false, limit: 10 });
    expect(stored.map((item) => item.kind)).toEqual(['executor.notify', 'executor.notify']);
    expect(stored[0]).toMatchObject({ userId: OWNER, url: '/all' });
  });

  it('limits core review-ready pushes to one per ticket per ten minutes', async () => {
    const { deliver, notify } = setup([
      page([notice(9, 'review_ready'), notice(10, 'review_ready')]),
      page([notice(11, 'review_ready')]),
    ]);
    await notify();
    await notify();
    expect(deliver).toHaveBeenCalledOnce();
  });

  it('skips old notices and topics it does not know, so a restart is not a flood', async () => {
    const { deliver, notify } = setup([page([notice(9, 'live', '2026-11-18T03:00:00.000Z'), notice(10, 'deploy')])]);
    await notify();
    expect(deliver).not.toHaveBeenCalled();
  });

  it('starts a little before the feed’s head, not from its beginning', async () => {
    const { events, notify } = setup([], 500);
    await notify();
    expect(events.mock.calls[1]![0]).toBe(300);
  });

  it('does nothing without a core daemon or an owner', async () => {
    const { deps, events, notify } = setup([]);
    deps.config.instanceOwnerId = undefined as unknown as string;
    await notify();
    expect(events).not.toHaveBeenCalled();
  });

  it('backs off unavailable feeds, logs each cause once, and resumes after recovery', async () => {
    const deps = makeDeps();
    deps.config.instanceOwnerId = OWNER;
    let now = NOW.getTime();
    const log = vi.fn();
    deps.log = log;
    const events = vi
      .fn()
      .mockRejectedValueOnce(new AiurHttpError(404, 'feature_disabled', '', 'core'))
      .mockRejectedValueOnce(new AiurHttpError(404, 'feature_disabled', '', 'core'))
      .mockRejectedValueOnce(new AiurHttpError(422, 'topic_not_exported', '', 'core'))
      .mockResolvedValue(page([]));
    deps.registry.coreAiurClient = { events } as unknown as AiurClient;
    const notify = createExecutorNotifier(deps, { deliver: async () => undefined, now: () => new Date(now) });
    await notify();
    await notify();
    expect(events).toHaveBeenCalledTimes(1);
    now += 600_000;
    await notify();
    expect(log).toHaveBeenCalledTimes(1);
    now += 600_000;
    await notify();
    expect(log).toHaveBeenLastCalledWith({
      event: 'executor_notify_error',
      error: 'AiurHttpError',
      status: 422,
      code: 'topic_not_exported',
    });
    now += 600_000;
    await notify();
    await notify();
    expect(events).toHaveBeenCalledTimes(6);
  });
});
