import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiurHttpError } from '@ogm/aiur-client';

import { startFeedConsumers } from '../../src/events/index.js';
import { daemon, harness, SLUG } from './helpers.js';

const running: { stop(): Promise<void> }[] = [];
afterEach(async () => {
  try {
    for (const feed of running.splice(0)) await feed.stop();
  } finally {
    vi.useRealTimers();
  }
});

describe('pollers', () => {
  it('verifies a terminal ticket snapshot against the tracker', async () => {
    const h = harness();
    const recover = vi.fn(async () => undefined);
    h.deps.onMissingIssue = recover;
    h.clientFor(SLUG).issue.mockResolvedValue({ issue_identifier: '142', running: { state: 'agent:done' } });
    const feed = startFeedConsumers(h.deps);
    running.push(feed);
    await feed.tick();
    expect(recover).toHaveBeenCalledWith(SLUG, '142');
  });
  it('asks the tracker to recover a ticket missing from Aiur', async () => {
    const h = harness();
    const recover = vi.fn(async () => undefined);
    h.deps.onMissingIssue = recover;
    h.clientFor(SLUG).issue.mockRejectedValue(new AiurHttpError(404, 'issue_not_found', 'missing', 'http://127.0.0.1'));
    const feed = startFeedConsumers(h.deps);
    running.push(feed);
    await feed.tick();
    expect(recover).toHaveBeenCalledWith(SLUG, '142');
  });
  it('reads progress and the issue for each active job of a running daemon', async () => {
    const h = harness();
    const feed = startFeedConsumers(h.deps);
    running.push(feed);
    await feed.tick();

    const client = h.clientFor(SLUG);
    expect(client.progress).toHaveBeenCalledWith('142');
    expect(client.issue).toHaveBeenCalledWith('142');
    expect(h.apply.progress).toHaveBeenCalledWith(SLUG, '142', expect.objectContaining({ issue_identifier: '142' }));
    expect(h.apply.issue).toHaveBeenCalledWith(SLUG, '142', expect.objectContaining({ issue_identifier: '142' }));
  });

  it('skips daemons that are not running and survives a failing read', async () => {
    const h = harness([{ ...daemon(), status: 'idle' }]);
    const feed = startFeedConsumers(h.deps);
    running.push(feed);
    await feed.tick();
    expect(h.clientFor(SLUG).progress).not.toHaveBeenCalled();

    h.listed.daemons = [daemon()];
    h.clientFor(SLUG).progress.mockRejectedValueOnce(new Error('aiur down'));
    await expect(feed.tick()).resolves.toBeUndefined();
    expect(h.apply.issue).toHaveBeenCalledTimes(1);
  });

  it('runs the progress poll on its 30 s interval', async () => {
    vi.useFakeTimers();
    const h = harness();
    const feed = startFeedConsumers({
      ...h.deps,
      intervals: { reconcileMs: 1e9, progressMs: 20, issueMs: 1e9, decisionsMs: 1e9 },
    });
    running.push(feed);
    await vi.advanceTimersByTimeAsync(40);
    expect(h.clientFor(SLUG).progress).toHaveBeenCalledTimes(2);
    expect(h.clientFor(SLUG).issue).not.toHaveBeenCalled();
  });
});
