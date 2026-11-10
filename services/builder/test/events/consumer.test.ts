import { AiurEventFeedError } from '@ogm/aiur-client';
import { afterEach, describe, expect, it } from 'vitest';

import { readCursor, startFeedConsumers, writeCursor, FEED_PATTERNS } from '../../src/events/index.js';
import { daemon, harness, SLUG } from './helpers.js';

const running: { stop(): Promise<void> }[] = [];
const EXPORTED_CATALOG_PATTERNS = [
  'ticket.*.lifecycle.changed',
  'ticket.*.usage.changed',
  'ticket.*.usage.spend_cap_reached',
  'ticket.*.cancel.result',
];

function validPattern(pattern: string): boolean {
  return pattern.split('.').every((segment) => segment === '*' || segment === '#' || /^[a-z0-9_-]+$/i.test(segment));
}

function narrows(requested: string, exported: string): boolean {
  const request = requested.split('.');
  const catalog = exported.split('.');
  if (request.length !== catalog.length) return false;
  return catalog.every((segment, index) => {
    const candidate = request[index];
    if (segment === '#') return true;
    if (segment === '*') return candidate !== '#';
    return candidate === segment;
  });
}

afterEach(async () => {
  for (const feed of running.splice(0)) await feed.stop();
});

function start(h: ReturnType<typeof harness>) {
  const feed = startFeedConsumers(h.deps);
  running.push(feed);
  return feed;
}

describe('feed consumers', () => {
  it('subscribes once per running daemon from the stored cursor with the exported topic patterns', async () => {
    const h = harness([daemon(), { ...daemon('other-game', 'everdred-games/other'), status: 'stopped' }]);
    writeCursor(h.db, SLUG, 811, 'epoch-1', new Date());
    const feed = start(h);
    await feed.tick();
    await feed.tick();

    expect(h.subscribe).toHaveBeenCalledTimes(1);
    expect(h.subscriptions[0]?.options).toMatchObject({ after: 811, patterns: FEED_PATTERNS });
    expect(FEED_PATTERNS).toEqual([
      'ticket.*.lifecycle.changed',
      'ticket.*.usage.changed',
      'ticket.*.usage.spend_cap_reached',
      'ticket.*.cancel.result',
    ]);
  });

  it('keeps every requested pattern valid and within the exported catalog', () => {
    for (const pattern of FEED_PATTERNS) {
      expect(validPattern(pattern), pattern).toBe(true);
      expect(
        EXPORTED_CATALOG_PATTERNS.some((exported) => narrows(pattern, exported)),
        `${pattern} must narrow an exported catalog pattern`,
      ).toBe(true);
    }
  });

  it('starts from 0 when no cursor is stored, and hands records to the projection with the daemon slug', async () => {
    const h = harness();
    const feed = start(h);
    await feed.tick();
    expect(h.subscriptions[0]?.options.after).toBe(0);

    const record = { type: 'gap', seq: 3, scope: '*', reason: 'exporter_start', from: null, to: 'x' } as const;
    h.subscriptions[0]?.options.onRecord(record);
    expect(h.apply.record).toHaveBeenCalledWith(SLUG, record);
  });

  it('on reset sets the cursor to head_seq and reads the issue once per active job', async () => {
    const h = harness();
    h.jobs.set(SLUG, [
      { jobId: 'j_142', ticket: '142' },
      { jobId: 'j_143', ticket: '143' },
    ]);
    writeCursor(h.db, SLUG, 10, null, new Date());
    const feed = start(h);
    await feed.tick();
    const client = h.clientFor(SLUG);
    client.issue.mockClear();
    h.apply.issue.mockClear();

    h.subscriptions[0]?.options.onReset({ oldest_seq: 400, head_seq: 900, epoch: 'epoch-2' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(readCursor(h.db, SLUG)).toBe(900);
    expect(client.issue.mock.calls.map(([id]) => id)).toEqual(['142', '143']);
    expect(h.apply.issue).toHaveBeenCalledTimes(2);
    expect(h.apply.issue).toHaveBeenCalledWith(SLUG, '142', expect.objectContaining({ issue_identifier: '142' }));
  });

  it('stops the consumer when listDaemons no longer lists the daemon', async () => {
    const h = harness();
    const feed = start(h);
    await feed.tick();
    const signal = h.subscriptions[0]?.options.signal;
    expect(signal?.aborted).toBe(false);

    h.listed.daemons = [];
    await feed.tick();
    expect(signal?.aborted).toBe(true);

    h.listed.daemons = [daemon()];
    await feed.tick();
    expect(h.subscribe).toHaveBeenCalledTimes(2);
  });

  it('alerts on feature_disabled and does not resubscribe while the daemon stays running', async () => {
    const h = harness();
    const feed = start(h);
    await feed.tick();
    h.subscriptions[0]?.options.onError(new AiurEventFeedError('feature_disabled'));
    h.subscriptions[0]?.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await feed.tick();

    expect(h.alerts).toEqual([expect.stringContaining('events.export.enabled')]);
    expect(h.subscribe).toHaveBeenCalledTimes(1);
  });

  it('stop() aborts every consumer', async () => {
    const h = harness();
    const feed = startFeedConsumers(h.deps);
    await feed.tick();
    await feed.stop();
    expect(h.subscriptions[0]?.options.signal.aborted).toBe(true);
  });
});
