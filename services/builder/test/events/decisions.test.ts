import { schema } from '@ogm/db';
import { describe, expect, it } from 'vitest';

import { createDecisionsPoller } from '../../src/events/decisions.js';
import { decision, harness, SLUG } from './helpers.js';
import type { AiurClient } from '@ogm/aiur-client';

function setup() {
  const h = harness();
  const client = h.clientFor(SLUG);
  const poll = createDecisionsPoller(h.deps);
  const daemons = [{ slug: SLUG, client: client as unknown as AiurClient }];
  const rows = () => h.db.select().from(schema.commands).all();
  return { h, client, poll: () => poll(daemons), rows };
}

describe('decisions poller', () => {
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
