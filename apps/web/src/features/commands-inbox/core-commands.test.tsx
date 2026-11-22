import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { REVIEW_POLL_MS, useCoreReviewCommands } from './commands';

const api = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api/client', async (actual) => ({
  ...(await actual<typeof import('../../lib/api/client')>()),
  api,
}));
const { ApiError } = await import('../../lib/api/client');

function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useCoreReviewCommands('creator'), { wrapper });
}

describe('core review Commands', () => {
  // A creator who is not the instance owner has no core Commands; the deck must not say it could not load reviews.
  it('reads a refusal for a creator who is not the instance owner as no core Commands', async () => {
    api.mockRejectedValue(new ApiError(403, { error: 'forbidden' }));
    const { result } = render();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ commands: [], targets: [], error: false });
  });

  it('still reports an unreachable core instance', async () => {
    api.mockRejectedValue(new ApiError(502, { error: 'core_daemon_unavailable' }));
    const { result } = render();
    await waitFor(() => expect(result.current.error).toBe(true));
  });

  it('refreshes review Commands within the 60 second live-update bound', () => {
    expect(REVIEW_POLL_MS).toBeGreaterThan(0);
    expect(REVIEW_POLL_MS).toBeLessThanOrEqual(60_000);
  });
});

describe('PC-daemon Commands', () => {
  // The NUC and the PC number their decisions independently, so the same id can be open on both at once.
  it('keys a PC Command apart from a NUC Command with the same id and routes it to the PC', async () => {
    const { commandPath, commandSource, ticketStatePath } = await import('../worker-builds/review-command');
    const nuc = {
      source: 'core' as const,
      job_id: null,
      ticket: '7',
      title: 'Pick',
      command_id: 'd',
      decision_id: 'd',
      version: 1,
      question: 'Which?',
      blocking: false,
      opened_at: '2026-01-01T00:00:00Z',
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
    };
    const pc = { ...nuc, daemon: 'pc' as const };
    expect(commandSource(nuc)).toBe('core');
    expect(commandSource(pc)).toBe('core:pc');
    expect(commandPath(nuc, '/d/answer')).toBe('/core/commands/d/answer');
    expect(commandPath(pc, '/d/answer')).toBe('/core/commands/d/answer?daemon=pc');
    expect(ticketStatePath({ ...pc, ticket: '7' })).toBe('/core/tickets/7/state?daemon=pc');
  });
});
