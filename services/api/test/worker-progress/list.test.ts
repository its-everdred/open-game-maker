import { describe, expect, it, vi } from 'vitest';
import { listWorkers } from '../../src/worker-progress/list.js';

describe('game workers', () => {
  it('projects running workers independently and uses each ticket progress', async () => {
    const client = {
      state: vi.fn(async (_signal?: AbortSignal) => ({
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
      })),
      progress: vi.fn(async (ticket: string, _limit?: number, _signal?: AbortSignal) => ({
        progress: ticket === '12' ? { status: 'known', percent: 50 } : { status: 'unknown' },
      })),
    };
    const workpad = vi.fn().mockResolvedValue('- [x] One\n- [ ] Two');
    expect(await listWorkers(client, workpad)).toEqual([
      {
        ticket: '12',
        title: 'Painted forest backdrop',
        startedAt: '2026-11-01T00:00:00Z',
        percent: 50,
        etaSeconds: 30,
        source: 'daemon',
      },
      { ticket: '13', title: 'Add a big boss', percent: 50, etaSeconds: 20, source: 'workpad' },
    ]);
    expect(workpad).toHaveBeenCalledOnce();
    expect(workpad).toHaveBeenCalledWith('13');
    expect(client.state.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal);
    expect(client.progress.mock.calls[0]?.[2]).toBeInstanceOf(AbortSignal);
  });
});
