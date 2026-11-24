import { describe, expect, it, vi } from 'vitest';
import { ENRICH_BUDGET_MS, listWorkers } from '../../src/worker-progress/list.js';

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
        running: true,
        title: 'Painted forest backdrop',
        startedAt: '2026-11-01T00:00:00Z',
        elapsedSeconds: 30,
        percent: 50,
        etaSeconds: null,
        source: 'daemon',
      },
      {
        ticket: '13',
        running: true,
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

describe('menu rows (#1326)', () => {
  const running = (ticket: string) => ({
    state: vi.fn().mockResolvedValue({
      running: [{ issue_identifier: ticket, title: 'Forest road', runtime_seconds: 5, work_state: 'working' }],
    }),
  });

  it('reads the workpad checklist only when aiur has no progress reading', async () => {
    const workpad = vi.fn(async () => '## Agent Workpad\n- [x] Road\n- [x] Trees\n- [ ] Stills\n- [ ] Crop');
    const unknown = {
      ...running('41'),
      progress: vi.fn().mockResolvedValue({ progress: { status: 'unknown' } }),
    };
    expect((await listWorkers(unknown, { workpad }))[0]).toMatchObject({ percent: 50, source: 'workpad' });
    expect(workpad).toHaveBeenCalledWith('41');

    workpad.mockClear();
    const known = {
      ...running('42'),
      progress: vi.fn().mockResolvedValue({ progress: { status: 'known', percent: 75 } }),
    };
    expect((await listWorkers(known, { workpad }))[0]).toMatchObject({ percent: 75, source: 'daemon' });
    expect(workpad).not.toHaveBeenCalled();
  });

  it('carries one plain line on where the ticket stands, cached between polls', async () => {
    const ticketDetail = vi.fn().mockResolvedValue({
      live: { running: true, activity: 'Placing tree clusters from the forests\nsecond line' },
      summary: { text: 'A road through the forest' },
    });
    const client = {
      baseUrl: 'http://daemon-a',
      ...running('43'),
      progress: vi.fn().mockResolvedValue({ progress: { status: 'known', percent: 55 } }),
      ticketDetail,
    };
    expect((await listWorkers(client))[0]!.last).toBe('Placing tree clusters from the forests');
    await listWorkers(client);
    expect(ticketDetail).toHaveBeenCalledTimes(1);

    const summaryOnly = {
      ...client,
      baseUrl: 'http://daemon-b',
      ticketDetail: vi.fn().mockResolvedValue({ live: null, summary: { text: 'A road through the forest' } }),
    };
    expect((await listWorkers(summaryOnly))[0]!.last).toBe('A road through the forest');

    const failing = {
      ...client,
      baseUrl: 'http://daemon-c',
      ticketDetail: vi.fn().mockRejectedValue(new Error('down')),
    };
    expect((await listWorkers(failing))[0]).not.toHaveProperty('last');
  });
});

describe('menu rows stay live when enrichment fails (#1326)', () => {
  const running = (ticket: string) => ({
    state: vi.fn().mockResolvedValue({
      running: [{ issue_identifier: ticket, title: 'Forest road', runtime_seconds: 5, work_state: 'working' }],
    }),
  });

  // A daemon timeout is not "no reading": an old checklist must not suddenly read as finished.
  it('keeps progress unknown when the progress read itself fails', async () => {
    const workpad = vi.fn(async () => '- [x] Done');
    const client = { ...running('51'), progress: vi.fn().mockRejectedValue(new Error('timeout')) };
    expect((await listWorkers(client, { workpad }))[0]).toMatchObject({ percent: null, source: 'unknown' });
    expect(workpad).not.toHaveBeenCalled();
  });

  it('answers without a slow workpad or detail read instead of holding the poll', async () => {
    vi.useFakeTimers();
    try {
      const never = new Promise<never>(() => undefined);
      const client = {
        baseUrl: 'http://daemon-slow',
        ...running('52'),
        progress: vi.fn().mockResolvedValue({ progress: { status: 'unknown' } }),
        ticketDetail: vi.fn(() => never),
      };
      const listed = listWorkers(client, { workpad: () => never });
      await vi.advanceTimersByTimeAsync(ENRICH_BUDGET_MS);
      expect((await listed)[0]).toMatchObject({ ticket: '52', percent: null });
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips both reads for a ticket waiting on review', async () => {
    const workpad = vi.fn(async () => '- [x] Done');
    const ticketDetail = vi.fn();
    const client = {
      state: vi.fn().mockResolvedValue({
        running: [],
        idle: [{ issue_identifier: '53', title: 'Review', state: 'agent:human-review', work_state: 'paused' }],
      }),
      progress: vi.fn().mockResolvedValue({ progress: { status: 'unknown' } }),
      ticketDetail,
    };
    await listWorkers(client, { workpad });
    expect(workpad).not.toHaveBeenCalled();
    expect(ticketDetail).not.toHaveBeenCalled();
  });
});
