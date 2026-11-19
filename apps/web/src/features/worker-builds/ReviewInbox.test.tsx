import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { queryClient } from '../../app/query';
import { ReviewInbox } from './ReviewInbox';

const api = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api/client', () => ({ api }));
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.clearAllMocks();
  vi.useRealTimers();
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
  expect(screen.getByText('2 left')).toBeVisible();
  expect(screen.getByText('First?')).toBeVisible();
  expect(screen.queryByText('Second?')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Needs changes' }));
  fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'More contrast' } });
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole('button', { name: 'Send changes' }));
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  vi.useRealTimers();
  await waitFor(
    () =>
      expect(api).toHaveBeenCalledWith('/games/g/review-rounds/a/answer', {
        method: 'POST',
        json: { verdict: 'needs_work', note: 'More contrast' },
      }),
    { timeout: 7000 },
  );
  await screen.findByText('Saved · sending to agent');
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByText('Second?')).toBeVisible();
  expect(screen.getByText('1 left')).toBeVisible();
}, 10000);

it('opens the selected review while keeping the rest of the queue', () => {
  const first = {
    kind: 'round' as const,
    gameId: 'g',
    round: { id: 'a', ticket: '12', question: 'First?', media: [{ kind: 'still' as const, url: '/first.png' }] },
  };
  const second = {
    kind: 'round' as const,
    gameId: 'g',
    round: { id: 'b', ticket: '12', question: 'Second?', media: [{ kind: 'still' as const, url: '/second.png' }] },
  };
  render(
    <QueryClientProvider client={queryClient}>
      <ReviewInbox commands={[]} onClose={() => {}} reviews={[first, second]} initialReview={second} />
    </QueryClientProvider>,
  );
  expect(screen.getByText('2 left')).toBeVisible();
  expect(screen.getByText('Second?')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByText('First?')).toBeVisible();
});

it('keeps an open review while an incomplete poll replaces the list', () => {
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
  fireEvent.click(screen.getByRole('button', { name: 'Needs changes' }));
  fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'Keep this' } });
  view.rerender(
    <QueryClientProvider client={queryClient}>
      <ReviewInbox commands={[]} onClose={() => {}} reviews={[second]} incomplete />
    </QueryClientProvider>,
  );
  expect(screen.getByText('First?')).toBeVisible();
  expect(screen.getByLabelText('Note (optional)')).toHaveValue('Keep this');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  view.rerender(
    <QueryClientProvider client={queryClient}>
      <ReviewInbox commands={[]} onClose={() => {}} reviews={[second]} />
    </QueryClientProvider>,
  );
  expect(screen.getByText('Second?')).toBeVisible();
});

it('replaces a superseded round for the same ticket while the queue is open', () => {
  const first = {
    kind: 'round' as const,
    gameId: 'g',
    round: { id: 'a', ticket: '12', question: 'Old?', media: [{ kind: 'still' as const, url: '/old.png' }] },
  };
  const replacement = {
    kind: 'round' as const,
    gameId: 'g',
    round: { id: 'b', ticket: '12', question: 'New?', media: [{ kind: 'still' as const, url: '/new.png' }] },
  };
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ReviewInbox commands={[]} reviews={[first]} onClose={() => {}} />
    </QueryClientProvider>,
  );
  view.rerender(
    <QueryClientProvider client={queryClient}>
      <ReviewInbox commands={[]} reviews={[replacement]} onClose={() => {}} />
    </QueryClientProvider>,
  );
  expect(screen.getByText('New?')).toBeVisible();
  expect(screen.queryByText('Old?')).toBeNull();
});

it('refreshes media on the open round when polling supplies it', async () => {
  api.mockResolvedValue({ status: 'asked' });
  const round = { id: 'a', ticket: '12', question: 'Review?', media: [] };
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ReviewInbox commands={[]} reviews={[{ kind: 'round', gameId: 'g', round }]} onClose={() => {}} />
    </QueryClientProvider>,
  );
  view.rerender(
    <QueryClientProvider client={queryClient}>
      <ReviewInbox
        commands={[]}
        reviews={[{ kind: 'round', gameId: 'g', round: { ...round, media: [{ kind: 'still', url: '/new.png' }] } }]}
        onClose={() => {}}
      />
    </QueryClientProvider>,
  );
  expect(await screen.findByRole('button', { name: 'Looks good' })).toBeVisible();
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

it('places a concept target beside a playable preview', () => {
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
            round: {
              id: 'a',
              ticket: '12',
              question: null,
              media: [{ kind: 'still', role: 'target', url: '/target.png' }],
              buildId: 'b',
            },
          },
        ]}
      />
    </QueryClientProvider>,
  );
  const compare = screen.getByLabelText('Concept target and review');
  expect(compare.querySelector('img[alt="Concept target"]')).toHaveAttribute('src', '/target.png');
  expect(compare.querySelector('.review-deck-playable-frame')).not.toBeNull();
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
        incomplete
        error
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

it('asks for a missing playable even if another query is unavailable', async () => {
  api.mockResolvedValue({ status: 'asked' });
  const round = { id: 'a', ticket: '12', question: 'Try it?', media: [], buildId: 'b' };
  render(
    <QueryClientProvider client={queryClient}>
      <ReviewInbox
        commands={[]}
        onClose={() => {}}
        reviews={[{ kind: 'round', gameId: 'g', round }]}
        incomplete
        error
      />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/games/g/review-rounds/a/missing-media?kind=build', expect.anything()),
  );
  expect(await screen.findByText('Asked the agent for media in the next round.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Looks good' })).toBeDisabled();
});

it('asks the worker and does not offer a verdict for a round without media', async () => {
  api.mockResolvedValue({ status: 'asked' });
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
              question: 'Review?',
              media: [{ kind: 'still', role: 'target', url: '/target.png' }],
            },
          },
        ]}
      />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(api).toHaveBeenCalledWith('/games/g/review-rounds/a/missing-media', { method: 'POST' }));
  expect(await screen.findByText('Asked the agent for media in the next round.')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Looks good' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Needs changes' })).toBeNull();
});

it('asks for missing media on later cards without waiting for the creator to open them', async () => {
  api.mockResolvedValue({ status: 'asked' });
  render(
    <QueryClientProvider client={queryClient}>
      <ReviewInbox
        commands={[]}
        onClose={() => {}}
        reviews={[
          {
            kind: 'round',
            gameId: 'g',
            round: { id: 'a', ticket: '12', question: 'First?', media: [{ kind: 'still', url: '/a.png' }] },
          },
          { kind: 'round', gameId: 'g', round: { id: 'b', ticket: '13', question: 'Second?', media: [] } },
        ]}
      />
    </QueryClientProvider>,
  );
  expect(screen.getByText('First?')).toBeVisible();
  await waitFor(() => expect(api).toHaveBeenCalledWith('/games/g/review-rounds/b/missing-media', { method: 'POST' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(await screen.findByText('Asked the agent for media in the next round.')).toBeVisible();
  expect(api).toHaveBeenCalledTimes(1);
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
  expect(screen.getByText('Review build')).toBeVisible();
  await waitFor(() => expect(api).toHaveBeenCalledWith('/games/g/tickets/42/missing-review', { method: 'POST' }));
  expect(await screen.findByText('Asked the agent for media in the next round.')).toBeVisible();
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
  const close = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <ReviewInbox commands={[core]} reviews={[]} onClose={close} />
    </QueryClientProvider>,
  );
  expect(screen.getByRole('button', { name: 'Pick A: A' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(close).toHaveBeenCalledOnce();
});

it('refreshes the version and options of the open command', () => {
  const command = {
    source: 'core' as const,
    job_id: null,
    ticket: '45',
    title: 'Question',
    command_id: 'c',
    decision_id: 'd',
    version: 1,
    question: 'Which?',
    blocking: true,
    opened_at: '2026-01-01T00:00:00Z',
    options: [{ id: 'a', label: 'Old', media: { url: '/a.png', width: 10, height: 10 } }],
  };
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ReviewInbox commands={[command]} reviews={[]} onClose={() => {}} />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'Keep my note' } });
  fireEvent.click(screen.getByRole('button', { name: 'Pick A: Old' }));
  expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
  view.rerender(
    <QueryClientProvider client={queryClient}>
      <ReviewInbox
        commands={[{ ...command, version: 2, options: [{ ...command.options[0]!, label: 'New' }] }]}
        reviews={[]}
        incomplete
        error
        onClose={() => {}}
      />
    </QueryClientProvider>,
  );
  expect(screen.getByRole('button', { name: 'Pick A: New' })).toBeVisible();
  expect(screen.queryByRole('dialog', { name: 'Pick A: Old' })).toBeNull();
  expect(screen.getByLabelText('Note (optional)')).toHaveValue('Keep my note');
});

it('keeps a command open while an answer is sending', async () => {
  let finish!: (value: unknown) => void;
  api.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const command = {
    game_id: 'g',
    game_title: 'Game',
    job_id: null,
    ticket: '45',
    title: 'Question',
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
  const close = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <ReviewInbox commands={[command]} reviews={[]} onClose={close} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Pick A: A' }));
  const sheet = within(screen.getByRole('dialog', { name: 'Pick A: A' }));
  const note = sheet.getByLabelText('Note (optional)');
  note.focus();
  fireEvent.keyDown(note, { key: 'Tab' });
  expect(note).toHaveFocus();
  fireEvent.click(sheet.getByRole('button', { name: 'Send choice' }));
  expect(screen.getByRole('button', { name: 'Pick A: A' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
  fireEvent.keyDown(screen.getByRole('dialog', { name: 'Pick A: A' }), { key: 'Escape' });
  expect(close).not.toHaveBeenCalled();
  finish({ status: 'answered' });
  await screen.findByText(/Saved/);
});

it('does not report a just-answered ticket as missing while its state catches up', async () => {
  api.mockResolvedValue({ status: 'answered' });
  const round = {
    kind: 'round' as const,
    gameId: 'g',
    round: { id: 'a', ticket: '12', question: 'Review?', media: [{ kind: 'still' as const, url: '/a.png' }] },
  };
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ReviewInbox commands={[]} reviews={[round]} onClose={() => {}} />
    </QueryClientProvider>,
  );
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole('button', { name: 'Looks good' }));
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  vi.useRealTimers();
  await screen.findByText('Saved · sending to agent', {}, { timeout: 7000 });
  view.rerender(
    <QueryClientProvider client={queryClient}>
      <ReviewInbox
        commands={[]}
        reviews={[]}
        targets={[{ gameId: 'g', ticket: '12', title: 'Review again' }]}
        onClose={() => {}}
      />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.queryByRole('button', { name: 'Review again' })).toBeNull();
  expect(api).not.toHaveBeenCalledWith('/games/g/tickets/12/missing-review', expect.anything());
}, 10000);

it('opens the selected missing-review target and advances when it is replaced', async () => {
  api.mockImplementation(() => new Promise(() => {}));
  const target = { gameId: 'g', ticket: '42', title: 'Missing castle' };
  const review = {
    kind: 'round' as const,
    gameId: 'g',
    round: { id: 'r', ticket: '13', question: 'Other review', media: [{ kind: 'still' as const, url: '/still.png' }] },
  };
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ReviewInbox commands={[]} reviews={[review]} targets={[target]} initialTarget={target} onClose={() => {}} />
    </QueryClientProvider>,
  );
  expect(screen.getByText('Missing castle')).toBeVisible();
  expect(screen.queryByText('Other review')).toBeNull();
  const matching = { ...review, round: { ...review.round, id: 'match', ticket: '42', question: 'Castle review' } };
  view.rerender(
    <QueryClientProvider client={queryClient}>
      <ReviewInbox commands={[]} reviews={[review, matching]} targets={[]} initialTarget={target} onClose={() => {}} />
    </QueryClientProvider>,
  );
  await screen.findByText('Castle review');
  expect(screen.queryByText('Missing castle')).toBeNull();
});
