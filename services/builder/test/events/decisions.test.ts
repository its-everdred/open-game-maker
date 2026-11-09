import { migrate, openDb, schema } from '@ogm/db';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDecisionsPoller } from '../../src/events/decisions.js';
import { startFeedConsumers } from '../../src/events/index.js';
import { decision, harness, SLUG } from './helpers.js';
import { buildFleet, cleanupHomes, tempHome } from '../fleet/helpers.js';
import type { AiurClient, SubscribeEventsOptions } from '@ogm/aiur-client';

afterEach(cleanupHomes);

function setup() {
  const h = harness();
  const client = h.clientFor(SLUG);
  const poll = createDecisionsPoller(h.deps);
  const daemons = [{ slug: SLUG, client: client as unknown as AiurClient }];
  const rows = () => h.db.select().from(schema.commands).all();
  return { h, client, poll: () => poll(daemons), rows };
}

describe('decisions poller', () => {
  it('uses the daemon read token and stores the returned open Command', async () => {
    const home = await tempHome();
    const requests: { url: string; headers: Headers }[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/healthz')) return new Response(null, { status: 200 });
      if (url.endsWith('/api/v1/decisions')) {
        requests.push({ url, headers: new Headers(init?.headers) });
        return Response.json({ decisions: [decision('d1', '142')] });
      }
      return Response.json({ error: 'not_found' }, { status: 404 });
    });
    const { fleet } = buildFleet(home, {
      fetch: fetchImpl,
      preflight: async () => ({ ok: true as const }),
    });
    await fleet.ensureDaemon({ slug: SLUG, repo: 'everdred-games/instance' }, 'feature');

    const { sqlite, db } = openDb(':memory:');
    migrate({ sqlite });
    const subscribe = vi.fn(
      (_client: AiurClient, options: SubscribeEventsOptions) =>
        new Promise<void>((resolve) => options.signal.addEventListener('abort', () => resolve(), { once: true })),
    );
    const log = vi.fn();
    const feed = startFeedConsumers({
      fleet,
      db,
      activeJobs: () => [{ jobId: 'j_142', ticket: '142' }],
      apply: { record: vi.fn(), issue: vi.fn(), progress: vi.fn() },
      subscribe,
      log,
      intervals: { reconcileMs: 1e9, progressMs: 1e9, issueMs: 1e9, decisionsMs: 1e9 },
    });

    try {
      await feed.tick();
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe('http://127.0.0.1:4101/api/v1/decisions');
      expect(requests[0]?.headers.get('authorization')).toBe('Bearer aiur_token2');
      expect(db.select().from(schema.commands).all()).toEqual([
        expect.objectContaining({
          decisionId: 'd1',
          jobId: 'j_142',
          daemonSlug: SLUG,
          status: 'open',
        }),
      ]);
      expect(log).not.toHaveBeenCalledWith(expect.objectContaining({ event: 'aiur-decisions-poll-failed' }));
    } finally {
      await feed.stop();
      sqlite.close();
    }
  });

  it('creates an open command for an open Command on a job ticket, ignoring other tickets', async () => {
    const { h, client, poll, rows } = setup();
    client.decisions.mockResolvedValue([decision('d1', '142'), decision('d9', '999')]);
    await poll();

    expect(rows()).toEqual([
      {
        decisionId: 'd1',
        jobId: 'j_142',
        daemonSlug: SLUG,
        version: 1,
        question: 'Which castle wall colour?',
        options: JSON.stringify([
          { id: 'grey', label: 'Grey stone' },
          { id: 'red', label: 'Red brick' },
        ]),
        recommend: 'grey',
        status: 'open',
        openedAt: '2026-11-01T03:00:00Z',
        answeredAt: null,
      },
    ]);
    expect(h.emitted).toEqual([{ kind: 'command.requested', jobId: 'j_142', decisionId: 'd1' }]);

    await poll();
    expect(h.emitted).toHaveLength(1);
  });

  it('marks it answered when the Command disappears', async () => {
    const { h, client, poll, rows } = setup();
    client.decisions.mockResolvedValueOnce([decision('d1', '142')]).mockResolvedValueOnce([]);
    await poll();
    await poll();

    expect(rows()[0]).toMatchObject({ status: 'answered', answeredAt: '2026-11-01T03:12:10.000Z' });
    expect(h.emitted).toContainEqual({ kind: 'command.answered', jobId: 'j_142', decisionId: 'd1' });
  });

  it('marks it answered when the Command carries an answer', async () => {
    const { client, poll, rows } = setup();
    client.decisions
      .mockResolvedValueOnce([decision('d1', '142')])
      .mockResolvedValueOnce([decision('d1', '142', { decision_status: 'decided', answer: { option: 'red' } })]);
    await poll();
    await poll();
    expect(rows()[0]?.status).toBe('answered');
  });

  it('marks it moot when its job is no longer active', async () => {
    const { h, client, poll, rows } = setup();
    client.decisions.mockResolvedValueOnce([decision('d1', '142')]).mockResolvedValueOnce([decision('d1', '142')]);
    await poll();
    h.jobs.set(SLUG, []);
    await poll();
    expect(rows()[0]?.status).toBe('moot');
  });
});
