import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { queryClient } from '../../app/query';
import { RoundReviews } from './RoundReviews';

const send = vi.fn().mockResolvedValue({ status: 'answered' });
vi.mock('../../lib/api/client', () => ({ api: (...args: unknown[]) => send(...args) }));
afterEach(() => {
  cleanup();
  send.mockReset().mockResolvedValue({ status: 'answered' });
  queryClient.clear();
});

it('lets the creator play and answer a live gameplay round', async () => {
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <RoundReviews
          gameId="game"
          rounds={[
            {
              id: 'round',
              ticket: '42',
              track: 'gameplay',
              buildId: 'live-round',
              playUrl: 'https://app.test/live/demo/42?scenario=yard',
              question: 'How does it feel?',
              media: [],
            },
          ]}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  expect(screen.getByText('Play this build')).toHaveAttribute('href', '/live/demo/42?scenario=yard');
  fireEvent.click(screen.getByText('Looks right'));
  await waitFor(() =>
    expect(send).toHaveBeenCalledWith(
      '/games/game/review-rounds/round/answer',
      expect.objectContaining({ json: { verdict: 'approved' } }),
    ),
  );
});

it('offers playback for an audio mock', () => {
  render(
    <QueryClientProvider client={queryClient}>
      <RoundReviews
        gameId="game"
        rounds={[{ id: 'round', ticket: '42', question: null, media: [{ kind: 'audio', url: '/cue.wav' }] }]}
      />
    </QueryClientProvider>,
  );
  expect(screen.getByLabelText('Review audio').getAttribute('src')).toBe('/cue.wav');
});

it('marks a replacement review round as new while the screen is open', async () => {
  const { rerender } = render(
    <QueryClientProvider client={queryClient}>
      <RoundReviews gameId="game" rounds={[{ id: 'first', ticket: '42', question: null, media: [] }]} />
    </QueryClientProvider>,
  );
  expect(screen.queryByText('New round')).toBeNull();
  rerender(
    <QueryClientProvider client={queryClient}>
      <RoundReviews gameId="game" rounds={[{ id: 'replacement', ticket: '42', question: null, media: [] }]} />
    </QueryClientProvider>,
  );
  expect(await screen.findByText('New round')).toBeVisible();
});

it('shows a named concept target beside the submitted image', () => {
  render(
    <QueryClientProvider client={queryClient}>
      <RoundReviews
        gameId="game"
        rounds={[
          {
            id: 'round',
            ticket: '42',
            question: null,
            media: [
              { kind: 'still', url: '/concept.png', role: 'target' },
              { kind: 'still', url: '/work.png' },
            ],
          },
        ]}
      />
    </QueryClientProvider>,
  );
  const compare = screen.getByLabelText('Concept target and review');
  expect(compare.querySelector('img[alt="Concept target"]')).toHaveAttribute('src', '/concept.png');
  expect(compare.querySelector('img[alt="Review"]')).toHaveAttribute('src', '/work.png');
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
  expect(document.querySelector('video')).toHaveProperty('muted', true);
  expect(document.querySelector('video')).toHaveProperty('loop', true);
  expect(document.querySelector('video')).toHaveProperty('autoplay', true);
  fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: '  Keep\nthis.  ' } });
  fireEvent.click(screen.getByText('Needs work'));
  await waitFor(() =>
    expect(send).toHaveBeenCalledWith('/games/game/review-rounds/round/answer', {
      method: 'POST',
      json: { verdict: 'needs_work', note: '  Keep\nthis.  ' },
    }),
  );
});

it('shows published prototype details and lets the creator submit a verdict', async () => {
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <RoundReviews
          gameId="game"
          rounds={[
            {
              id: 'published-round',
              ticket: 'publish',
              track: 'prototype-publish',
              buildId: 'build_1',
              playUrl: 'https://app.example/g/game?mode=edit&build=build_1&scenario=wave-3',
              sliceUrl: 'https://app.example/g/game/play?build=build_1&scenario=wave-3',
              question: 'Review the published build',
              works: ['Walk around'],
              limitations: ['No attack yet'],
              decisionIds: ['enemy-lineup'],
              clipStatus: 'unchecked',
              media: [],
            },
          ]}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  /* Same-tab, in-app: a target=_blank link throws a home-screen app out to the browser. */
  const play = screen.getByRole('link', { name: 'Play this build' });
  expect(play).toHaveAttribute('href', '/g/game?mode=edit&build=build_1&scenario=wave-3');
  expect(play).not.toHaveAttribute('target');
  /* Kevin, #1281: the card plays the reviewed slice in place, on the app's origin, past the title. */
  expect(screen.getByTitle('Play the build for ticket publish')).toHaveAttribute(
    'src',
    '/g/game/play?build=build_1&scenario=wave-3',
  );
  expect(screen.getByText('Walk around')).toBeVisible();
  expect(screen.getByText('No attack yet')).toBeVisible();
  expect(screen.getByText('enemy-lineup')).toBeVisible();
  expect(screen.getByText('Clip: unchecked')).toBeVisible();
  fireEvent.click(screen.getByText('Looks right'));
  await waitFor(() =>
    expect(send).toHaveBeenCalledWith('/games/game/review-rounds/published-round/answer', expect.anything()),
  );
});

it('reports that the agent was sent the verdict only after the reconciler confirms delivery', async () => {
  send.mockImplementation(async (path: string) =>
    path.endsWith('/status')
      ? { status: 'sent', newRound: true, nextPhase: { phase: 'build', ticket: '42' } }
      : { status: 'answered' },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RoundReviews gameId="game" rounds={[{ id: 'round', ticket: '42', question: null, media: [] }]} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByText('Needs work'));
  expect(
    await screen.findByText('Saved · sent to agent · New round ready · Next phase: build (ticket 42)'),
  ).toBeVisible();
});
