import { describe, expect, it, vi } from 'vitest';
import { listWorkers } from '../../src/worker-progress/list.js';

describe('game workers', () => {
  it('projects running workers independently and uses each ticket progress', async () => {
    const client = {
      state: vi.fn().mockResolvedValue({
        running: [
          {
            issue_identifier: '12',
            title: 'Painted forest backdrop',
            runtime_seconds: 30,
            work_state: 'working',
            started_at: '2026-11-01T00:00:00Z',
          },
          { issue_identifier: '13', title: 'Add a big boss monster now', runtime_seconds: 20, work_state: 'working' },
          { issue_identifier: '14', title: 'Paused worker', runtime_seconds: 20, work_state: 'paused' },
        ],
      }),
      progress: vi.fn(async (ticket: string) => ({
        progress: ticket === '12' ? { status: 'known', percent: 50 } : { status: 'unknown' },
      })),
    };
    expect(await listWorkers(client)).toEqual([
      {
        ticket: '12',
        title: 'Painted forest backdrop',
        startedAt: '2026-11-01T00:00:00Z',
        elapsedSeconds: 30,
        percent: 50,
        etaSeconds: null,
        source: 'daemon',
      },
      {
        ticket: '13',
        title: 'Add a big boss monster now',
        elapsedSeconds: 20,
        percent: null,
        etaSeconds: null,
        source: 'unknown',
      },
    ]);
    expect(client.state).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(client.progress).toHaveBeenCalledWith('12', undefined, expect.any(AbortSignal));
  });

  it('keeps waiting tickets visible without treating their check-in as completion', async () => {
    const client = {
      state: vi.fn().mockResolvedValue({
        running: [],
        idle: [
          { issue_identifier: '42', title: 'Review the forest', state: 'agent:human-review', work_state: 'paused' },
        ],
      }),
      progress: vi.fn().mockResolvedValue({
        progress: { status: 'known', percent: 100 },
        phase: { status: 'known', value: 'review' },
      }),
    };
    expect(await listWorkers(client)).toEqual([
      {
        ticket: '42',
        title: 'Review the forest',
        state: 'human-review',
        phase: 'review',
        percent: null,
        etaSeconds: null,
        source: 'unknown',
      },
    ]);
  });
});
