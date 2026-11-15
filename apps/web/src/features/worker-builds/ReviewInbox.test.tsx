import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { queryClient } from '../../app/query';
import { ReviewInbox } from './ReviewInbox';

const api = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api/client', () => ({ api }));
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.clearAllMocks();
});

it('answers a ledger round with a note and advances to the next review', async () => {
  api.mockResolvedValue({ status: 'answered' });
  render(
    <QueryClientProvider client={queryClient}>
      <ReviewInbox
        commands={[]}
        onClose={() => {}}
        reviews={[
          { kind: 'round', gameId: 'g', round: { id: 'a', ticket: '12', question: 'First?', media: [] } },
          { kind: 'round', gameId: 'g', round: { id: 'b', ticket: '13', question: 'Second?', media: [] } },
        ]}
      />
    </QueryClientProvider>,
  );
  expect(screen.getByText('First?')).toBeVisible();
  expect(screen.queryByText('Second?')).toBeNull();
  fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'More contrast' } });
  fireEvent.click(screen.getByRole('button', { name: 'Needs work' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/games/g/review-rounds/a/answer', {
      method: 'POST',
      json: { verdict: 'needs_work', note: 'More contrast' },
    }),
  );
  await screen.findByText('Second?');
});

it('keeps an open review while polling replaces the list', () => {
  const first = {
    kind: 'round' as const,
    gameId: 'g',
    round: { id: 'a', ticket: '12', question: 'First?', media: [] },
  };
  const second = {
    kind: 'round' as const,
    gameId: 'g',
    round: { id: 'b', ticket: '13', question: 'Second?', media: [] },
  };
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ReviewInbox commands={[]} onClose={() => {}} reviews={[first, second]} />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'Keep this' } });
  view.rerender(
    <QueryClientProvider client={queryClient}>
      <ReviewInbox commands={[]} onClose={() => {}} reviews={[second]} />
    </QueryClientProvider>,
  );
  expect(screen.getByText('First?')).toBeVisible();
  expect(screen.getByLabelText('Note (optional)')).toHaveValue('Keep this');
});

it('allows playing clips attached to a playable review', () => {
  api.mockImplementation(() => new Promise(() => {}));
  render(
    <QueryClientProvider client={queryClient}>
      <ReviewInbox
        commands={[]}
        onClose={() => {}}
        reviews={[
          {
            kind: 'preview',
            gameId: 'g',
            preview: { ticket: '12', buildId: 'b', accessId: 'access', createdAt: '2026-01-01' },
            round: { id: 'a', ticket: '12', question: null, media: [{ kind: 'clip', url: '/clip.mp4' }], buildId: 'b' },
          },
        ]}
      />
    </QueryClientProvider>,
  );
  const video = document.querySelector('video');
  expect(video).toHaveAttribute('controls');
  expect(video).toHaveStyle({ pointerEvents: 'auto' });
});

it('recovers an unavailable playable when its preview arrives', async () => {
  api.mockImplementation(() => new Promise(() => {}));
  const round = { id: 'a', ticket: '12', question: 'Try it?', media: [], buildId: 'b' };
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ReviewInbox commands={[]} onClose={() => {}} reviews={[{ kind: 'round', gameId: 'g', round }]} />
    </QueryClientProvider>,
  );
  expect(screen.getByText('The playable review is unavailable. Try again later.')).toBeVisible();
  view.rerender(
    <QueryClientProvider client={queryClient}>
      <ReviewInbox
        commands={[]}
        onClose={() => {}}
        reviews={[
          {
            kind: 'preview',
            gameId: 'g',
            round,
            preview: { ticket: '12', buildId: 'b', accessId: 'a', createdAt: '2026-01-01' },
          },
        ]}
      />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.queryByText('The playable review is unavailable. Try again later.')).toBeNull());
});
