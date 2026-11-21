import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { useAnsweredReviews } from './useAnsweredReviews';

const api = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api/client', () => ({ api }));

afterEach(() => {
  sessionStorage.removeItem('ogm:answered-review-commands');
  sessionStorage.removeItem('ogm:answered-review-game-ids');
  vi.clearAllMocks();
});

it('reads durable game answers and retains core answers for the browser session', async () => {
  api.mockResolvedValue({ reviews: [{
    id: 'r_1', game_id: 'g', job_id: null, ticket: '45', title: 'Castle', command_id: 'c', decision_id: 'd',
    question: 'Which colors?', option_id: 'b', likes: [{ option_id: 'b', label: 'Blue' }], dislikes: [], notes: 'Keep the trim', at: '2026-01-01T00:00:00Z',
  }] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const command = {
    source: 'core' as const, job_id: null, ticket: '46', title: 'Core', command_id: 'core-c', decision_id: 'core-d', version: 1,
    question: 'Which?', blocking: true, opened_at: '2026-01-01T00:00:00Z', options: [{ id: 'a', label: 'A' }],
  };
  const first = renderHook(() => useAnsweredReviews([], []), { wrapper });
  act(() => first.result.current.rememberCommand(command));
  first.unmount();
  const reopened = renderHook(() => useAnsweredReviews([], []), { wrapper });
  expect(reopened.result.current.sessionAnsweredCommands).toHaveLength(1);
  const gameCommand = {
    game_id: 'g', game_title: 'Game', job_id: null, ticket: '45', title: 'Castle', command_id: 'c', decision_id: 'd', version: 1,
    question: 'Which colors?', blocking: true, opened_at: '2026-01-01T00:00:00Z', options: [{ id: 'b', label: 'Blue' }],
  };
  const ledger = renderHook(() => useAnsweredReviews([], [gameCommand]), { wrapper });
  await waitFor(() => expect(ledger.result.current.savedCommands).toMatchObject([{ gameId: 'g', review: { notes: 'Keep the trim' } }]));
  expect(api).toHaveBeenCalledWith('/games/g/reviews');
  reopened.unmount();
  ledger.unmount();
  client.clear();
  const restoredLedger = renderHook(() => useAnsweredReviews([], []), { wrapper });
  await waitFor(() => expect(restoredLedger.result.current.savedCommands).toMatchObject([{ gameId: 'g', review: { notes: 'Keep the trim' } }]));
  expect(api).toHaveBeenCalledWith('/games/g/reviews');
  restoredLedger.unmount();
  client.clear();
});
