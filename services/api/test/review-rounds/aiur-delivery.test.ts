import { expect, it, vi } from 'vitest';
import { aiurReworkDelivery } from '../../src/review-rounds/aiur-delivery.js';

it('finds a queued marker on an older page before retrying rework', async () => {
  const ticketTranscript = vi
    .fn()
    .mockResolvedValueOnce({ events: [], nextCursor: '12' })
    .mockResolvedValueOnce({
      events: [{ body: 'reason <!-- gm-review-verdict:r -->', turn_id: null }],
      nextCursor: null,
    });
  const rework = vi.fn();
  const issue = vi.fn().mockResolvedValue({ status: 'idle', running: null, queue: { depth: 1 } });
  const delivery = aiurReworkDelivery({ ticketTranscript, rework, issue }, 'r', '2026-01-01T00:00:00Z');
  expect(await delivery.findMarker('42', '<!-- gm-review-verdict:r -->')).toEqual({ runId: null });
  expect(ticketTranscript).toHaveBeenLastCalledWith('42', '12');
  expect(rework).not.toHaveBeenCalled();
});

it('fails closed on a repeated cursor rather than treating an incomplete search as absence', async () => {
  const delivery = aiurReworkDelivery(
    { ticketTranscript: vi.fn().mockResolvedValue({ events: [], nextCursor: '12' }), rework: vi.fn(), issue: vi.fn() },
    'r',
    '2026-01-01T00:00:00Z',
  );
  await expect(delivery.findMarker('42', 'marker')).rejects.toThrow('aiur_transcript_cursor_repeated');
});

it('records the consuming turn even if the worker finished before the next pass', async () => {
  const issue = vi.fn();
  const delivery = aiurReworkDelivery(
    {
      ticketTranscript: vi
        .fn()
        .mockResolvedValue({ events: [{ body: 'marker', turn_id: 'run-finished' }], nextCursor: null }),
      rework: vi.fn(),
      issue,
    },
    'r',
    '2026-01-01T00:00:00Z',
  );
  expect(await delivery.findMarker('42', 'marker')).toEqual({ runId: 'run-finished' });
  expect(issue).not.toHaveBeenCalled();
});

it('waits for the queued input to drain into a new worker session before naming its run', async () => {
  const client = {
    ticketTranscript: vi.fn().mockResolvedValue({ events: [{ body: 'marker' }], nextCursor: null }),
    rework: vi.fn(),
    issue: vi.fn().mockResolvedValue({
      status: 'running',
      running: { session_id: 'session-1', started_at: '2026-01-01T00:00:01Z' },
      queue: { depth: 1 },
    }),
  };
  const delivery = aiurReworkDelivery(client, 'r', '2026-01-01T00:00:00Z');
  expect(await delivery.findMarker('42', 'marker')).toEqual({ runId: null });
  client.issue.mockResolvedValue({
    status: 'running',
    running: { session_id: 'session-1', started_at: '2026-01-01T00:00:01Z' },
    queue: { depth: 0 },
  });
  expect(await delivery.findMarker('42', 'marker')).toEqual({ runId: 'session-1' });
});
