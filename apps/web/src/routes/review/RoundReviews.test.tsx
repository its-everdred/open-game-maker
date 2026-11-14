import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { queryClient } from '../../app/query';
import { RoundReviews } from './RoundReviews';

const send = vi.fn().mockResolvedValue({ status: 'answered' });
vi.mock('../../lib/api/client', () => ({ api: (...args: unknown[]) => send(...args) }));
afterEach(() => {
  cleanup();
  send.mockClear();
  queryClient.clear();
});

it('shows the capture and sends the creator notes without trimming', async () => {
  render(
    <QueryClientProvider client={queryClient}>
      <RoundReviews
        gameId="game"
        rounds={[
          {
            id: 'round',
            ticket: '42',
            question: null,
            media: [{ kind: 'clip', url: '/capture.mp4' }],
          },
        ]}
      />
    </QueryClientProvider>,
  );
  expect(document.querySelector('video')?.getAttribute('src')).toBe('/capture.mp4');
  fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: '  Keep\nthis.  ' } });
  fireEvent.click(screen.getByText('Needs work'));
  await waitFor(() =>
    expect(send).toHaveBeenCalledWith('/games/game/review-rounds/round/answer', {
      method: 'POST',
      json: { verdict: 'needs_work', note: '  Keep\nthis.  ' },
    }),
  );
});
