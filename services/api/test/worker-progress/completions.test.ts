import { schema } from '@ogm/db';
import { describe, expect, it } from 'vitest';
import { recentCompletions } from '../../src/worker-progress/completions.js';
import { makeDeps } from '../helpers.js';

describe('worker completion events', () => {
  it('uses only the latest tracker-confirmed lifecycle per ticket and game', () => {
    const { db } = makeDeps();
    const event = (daemonSlug: string, seq: number, ticket: string, lifecycle: string, source = 'tracker') => ({
      daemonSlug,
      seq,
      ticket,
      topic: `ticket.${ticket}.lifecycle.changed`,
      payload: JSON.stringify({ lifecycle, lifecycle_source: source }),
      observedAt: '2026-11-01T00:00:00Z',
    });
    db.insert(schema.aiurEvents)
      .values([
        event('game', 1, '12', 'completed'),
        event('game', 2, '13', 'completed'),
        event('game', 3, '13', 'running'),
        event('game', 4, '14', 'paused'),
        event('game', 5, '15', 'completed', 'status_report'),
        event('other', 9, '99', 'completed'),
      ])
      .run();
    expect(recentCompletions(db, 'game')).toEqual({
      cursor: 5,
      completed: [{ ticket: '12', seq: 1, at: '2026-11-01T00:00:00Z' }],
    });
  });
});

describe('recent worker completions', () => {
  it('uses the most recently ingested ticket event across feed epochs', () => {
    const { db } = makeDeps();
    db.insert(schema.aiurEvents)
      .values([
        {
          daemonSlug: 'game',
          epoch: 'old',
          seq: 100,
          ticket: '12',
          topic: 'ticket.12.lifecycle.changed',
          payload: JSON.stringify({ lifecycle: 'running' }),
          observedAt: '2026-11-01T00:00:00Z',
        },
        {
          daemonSlug: 'game',
          epoch: 'new',
          seq: 1,
          ticket: '12',
          topic: 'ticket.12.lifecycle.changed',
          payload: JSON.stringify({ lifecycle: 'completed', lifecycle_source: 'tracker' }),
          observedAt: '2026-11-01T00:00:01Z',
        },
      ])
      .run();
    expect(recentCompletions(db, 'game').completed).toEqual([{ ticket: '12', seq: 1, at: '2026-11-01T00:00:01Z' }]);
  });
});
