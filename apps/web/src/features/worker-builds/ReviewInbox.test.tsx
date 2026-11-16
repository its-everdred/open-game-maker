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
          {
            kind: 'round',
            gameId: 'g',
            round: {
              id: 'a',
              ticket: '12',
              question: 'First?',
              media: [{ kind: 'still' as const, url: '/first.png' }],
            },
          },
          {
            kind: 'round',
            gameId: 'g',
            round: {
              id: 'b',
              ticket: '13',
              question: 'Second?',
              media: [{ kind: 'still' as const, url: '/second.png' }],
            },
          },
        ]}
      />
    </QueryClientProvider>,
  );
  expect(screen.getByRole('button', { name: 'Second?' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'First?' }));
  expect(screen.queryByText('Second?')).toBeNull();
  fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'More contrast' } });
  fireEvent.click(screen.getByRole('button', { name: 'Needs work' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/games/g/review-rounds/a/answer', {
      method: 'POST',
      json: { verdict: 'needs_work', note: 'More contrast' },
    }),
  );
  await screen.findByText('Saved');
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByRole('button', { name: 'Second?' })).toBeVisible();
});

it('keeps an open review while polling replaces the list', () => {
  const first = {
    kind: 'round' as const,
    gameId: 'g',
    round: { id: 'a', ticket: '12', question: 'First?', media: [{ kind: 'still' as const, url: '/first.png' }] },
  };
  const second = {
    kind: 'round' as const,
    gameId: 'g',
    round: { id: 'b', ticket: '13', question: 'Second?', media: [{ kind: 'still' as const, url: '/second.png' }] },
  };
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ReviewInbox commands={[]} onClose={() => {}} reviews={[first, second]} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'First?' }));
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
  fireEvent.click(screen.getByRole('button', { name: 'Ticket 12' }));
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
  fireEvent.click(screen.getByRole('button', { name: 'Try it?' }));
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

it('asks the worker and does not offer a verdict for a round without media', async () => {
  api.mockResolvedValue({ status: 'asked' });
  render(
    <QueryClientProvider client={queryClient}>
      <ReviewInbox
        commands={[]}
        onClose={() => {}}
        reviews={[{ kind: 'round', gameId: 'g', round: { id: 'a', ticket: '12', question: 'Review?', media: [] } }]}
      />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(api).toHaveBeenCalledWith('/games/g/review-rounds/a/missing-media', { method: 'POST' }));
  expect(await screen.findByText('No media; asked the agent.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Review?' }));
  expect(screen.getByRole('alert')).toHaveTextContent('No media');
  expect(screen.queryByRole('button', { name: 'Looks right' })).toBeNull();
});

it('lists a review-stage ticket without an artifact and asks its worker for media', async () => {
  api.mockResolvedValue({ status: 'asked' });
  render(
    <QueryClientProvider client={queryClient}>
      <ReviewInbox
        commands={[]}
        reviews={[]}
        targets={[{ gameId: 'g', ticket: '42', title: 'Review build' }]}
        onClose={() => {}}
      />
    </QueryClientProvider>,
  );
  expect(screen.getByRole('button', { name: 'Review build' })).toBeVisible();
  await waitFor(() => expect(api).toHaveBeenCalledWith('/games/g/tickets/42/missing-review', { method: 'POST' }));
  expect(await screen.findByText('No media; asked the agent.')).toBeVisible();
});

it('lists core Commands alongside game reviews', () => {
  const core = {
    source: 'core' as const,
    job_id: null,
    ticket: '45',
    title: 'Core question',
    command_id: 'c',
    decision_id: 'd',
    version: 1,
    question: 'Which?',
    blocking: true,
    opened_at: '2026-01-01T00:00:00Z',
    options: [
      { id: 'a', label: 'A', media: { url: '/a.png', width: 10, height: 10 } },
      { id: 'b', label: 'B', media: { url: '/b.png', width: 10, height: 10 } },
    ],
  };
  render(
    <QueryClientProvider client={queryClient}>
      <ReviewInbox commands={[core]} reviews={[]} onClose={() => {}} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Core · Core question' }));
  expect(screen.getByRole('button', { name: 'Pick A: A' })).toBeVisible();
});
