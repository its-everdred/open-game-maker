import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GameCommand, ReviewDraftsPage } from '@ogm/contracts';

import { resetReviewDrafts, useIsSent } from './drafts';
import { ReviewDeck } from './ReviewDeck';

const calls: Array<{ url: string; method: string; body: unknown }> = [];
let answerStatus = 200;
let serverDrafts: ReviewDraftsPage['drafts'] = [];

function deckCommand(overrides: Partial<GameCommand> = {}): GameCommand {
  return {
    job_id: 'j_1',
    ticket: '478',
    title: 'Pick the voices',
    checkpoint_id: 'cp_1',
    decision_id: 'd_1',
    version: 3,
    question: 'Which voices should Blobs use?',
    options: [
      {
        id: 'v1',
        label: 'Voice one',
        media: { url: 'https://media.example.test/v1.wav', width: 320, height: 320, duration_ms: 2400 },
      },
      {
        id: 'v2',
        label: 'Voice two',
        media: { url: 'https://media.example.test/v2.wav', width: 320, height: 320, duration_ms: 2400 },
      },
      {
        id: 'v3',
        label: 'Voice three',
        media: { url: 'https://media.example.test/v3.wav', width: 320, height: 320, duration_ms: 2400 },
      },
    ],
    recommend: 'v1',
    blocking: true,
    opened_at: '2026-11-04T10:00:00.000Z',
    ...overrides,
  };
}

// The Blobs character voices deck (#631): each card is a portrait with the character's voice beside it.
function characterCommand(): GameCommand {
  return deckCommand({
    job_id: null,
    checkpoint_id: 'd_blobs',
    decision_id: 'd_blobs',
    version: 1,
    title: 'Blobs character voices',
    options: ['pip', 'mo'].map((id) => ({
      id,
      label: `${id} voice`,
      media: { url: `https://media.example.test/${id}.png`, width: 400, height: 600, kind: 'image' as const },
      audio: { url: `https://media.example.test/${id}.mp3`, width: 640, height: 360, duration_ms: 3000 },
    })),
  });
}

function renderDeck(command = deckCommand(), onAnswered = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    onAnswered,
    ...render(
      <QueryClientProvider client={client}>
        <ReviewDeck gameId="g_1" command={command} onAnswered={onAnswered} />
      </QueryClientProvider>,
    ),
  };
}

const answers = () => calls.filter(({ url }) => url.endsWith('/answer'));
const draftSaves = () => calls.filter(({ method, url }) => method === 'PUT' && url.includes('/review-drafts/'));

beforeEach(() => {
  calls.length = 0;
  answerStatus = 200;
  serverDrafts = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
      calls.push({ url, method, body });
      const json = (value: unknown, status = 200) =>
        new Response(status === 204 ? null : JSON.stringify(value), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      if (url.endsWith('/answer'))
        return json(answerStatus === 200 ? { status: 'answered' } : { error: 'no' }, answerStatus);
      if (url.endsWith('/review-drafts') && method === 'GET') return json({ drafts: serverDrafts });
      if (url.includes('/review-drafts/') && method === 'PUT') return json(null, 204);
      return json({ error: 'unexpected' }, 500);
    }),
  );
});

afterEach(() => {
  cleanup();
  resetReviewDrafts();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function vote(name: 'Like' | 'Dislike') {
  fireEvent.click(screen.getByRole('button', { name }));
  // A dislike opens its reason sheet; these votes skip it.
  const skip = screen.queryByRole('button', { name: 'Skip' });
  if (skip !== null) fireEvent.click(skip);
}

describe('ReviewDeck', () => {
  it('shows one card at a time and moves on when the creator likes it', () => {
    renderDeck();

    expect(screen.getByLabelText('Voice one')).toBeInTheDocument();
    expect(screen.getByText('1 of 3')).toBeVisible();
    expect(screen.queryByLabelText('Voice two')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Like' }));

    expect(screen.getByLabelText('Voice two')).toBeInTheDocument();
    expect(screen.getByText('2 of 3')).toBeVisible();
  });

  // Kevin (#631): no Send. The three votes are the only controls, undo first, then thumbs down, then thumbs up.
  it('offers undo, thumbs down and thumbs up, in that order, and nothing else', () => {
    renderDeck();

    const deck = screen.getByRole('region', { name: 'Review Pick the voices' });
    expect(
      within(deck)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Undo the last swipe', 'Dislike', 'Like']);
  });

  // The deck answers the Command itself once every card has a vote, with the whole map, and marks it sent.
  it('answers the Command once every card has a vote, and not before', async () => {
    const { onAnswered } = renderDeck();

    vote('Like');
    vote('Dislike');
    expect(answers()).toEqual([]);
    vote('Like');

    await waitFor(() => expect(onAnswered).toHaveBeenCalled());
    expect(answers()).toEqual([
      {
        url: '/api/v1/jobs/j_1/checkpoints/cp_1/answer',
        method: 'POST',
        body: { option_id: 'v1', review: { likes: ['v1', 'v3'], dislikes: [{ option_id: 'v2' }] } },
      },
    ]);
    // The rows and the arrows read the sent mark from the drafts, so the question shows as sent everywhere.
    expect(renderHook(() => useIsSent(deckCommand())).result.current).toBe(true);
  });

  it('waits for a dislike’s reason before it answers, and carries the words', async () => {
    renderDeck();

    vote('Like');
    vote('Like');
    fireEvent.click(screen.getByRole('button', { name: 'Dislike' }));
    const reason = await screen.findByRole('textbox', { name: 'Reason for disliking Voice three' });
    expect(answers()).toEqual([]);
    fireEvent.change(reason, { target: { value: 'too robotic' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add the reason' }));

    await waitFor(() =>
      expect(answers()[0]?.body).toEqual({
        option_id: 'v1',
        review: { likes: ['v1', 'v2'], dislikes: [{ option_id: 'v3', reason: 'too robotic' }] },
      }),
    );
  });

  // A Command no job owns answers through the game's own route.
  it('answers a Command no job owns through the game’s route', async () => {
    renderDeck(characterCommand());

    vote('Like');
    vote('Like');

    await waitFor(() =>
      expect(answers()).toEqual([
        {
          url: '/api/v1/games/g_1/commands/d_blobs/answer',
          method: 'POST',
          body: { option_id: 'pip', version: 1, review: { likes: ['pip', 'mo'], dislikes: [] } },
        },
      ]),
    );
  });

  // Each vote is saved on the server as it is cast, so leaving midway, a reload or another device keeps it.
  it('saves each vote as a draft on the server', async () => {
    renderDeck();

    vote('Like');
    await waitFor(() => expect(draftSaves()).toHaveLength(1));
    vote('Dislike');

    await waitFor(() => expect(draftSaves()).toHaveLength(2));
    expect(draftSaves().map(({ url }) => url)).toEqual([
      '/api/v1/games/g_1/review-drafts/cp_1%3A3',
      '/api/v1/games/g_1/review-drafts/cp_1%3A3',
    ]);
    expect(draftSaves().at(-1)!.body).toEqual({
      deck: {
        cards: [
          { option_id: 'v1', verdict: 'like' },
          { option_id: 'v2', verdict: 'dislike' },
        ],
      },
    });
  });

  it('picks up the votes saved on the server', async () => {
    serverDrafts = [
      {
        key: 'cp_1:3',
        deck: { cards: [{ option_id: 'v1', verdict: 'like' }] },
        updated_at: '2026-11-08T10:00:00.000Z',
      },
    ];
    renderDeck();

    expect(await screen.findByText('2 of 3')).toBeVisible();
    expect(screen.getByLabelText('Voice two')).toBeInTheDocument();
    // What came from the server is not sent back to it.
    expect(draftSaves()).toEqual([]);
  });

  // Few words on a card: its letter shows, and the option's label names the sample for assistive tech.
  it('labels each card with a letter and keeps the option label as its name', () => {
    renderDeck();

    expect(screen.getByText('A')).toBeVisible();
    expect(screen.queryByText('Voice one')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Like' }));
    expect(screen.getByText('B')).toBeVisible();
    expect(screen.getByLabelText('Voice two')).toBeInTheDocument();
  });

  // Moving to another question unmounts the deck; coming back must find the same votes, not a fresh deck.
  it('keeps the votes when the deck closes and reopens', () => {
    const first = renderDeck();
    vote('Like');
    vote('Like');
    first.unmount();

    renderDeck();
    expect(screen.getByText('3 of 3')).toBeVisible();
    expect(screen.getByLabelText('Voice three')).toBeInTheDocument();
  });

  // A Command reopened at a new version is a new question: an old draft never answers it.
  it('starts a fresh draft for a new version of the Command', () => {
    const first = renderDeck();
    vote('Like');
    first.unmount();

    renderDeck(deckCommand({ version: 4 }));
    expect(screen.getByText('1 of 3')).toBeVisible();
  });

  it('undoes the last vote', () => {
    renderDeck();

    vote('Like');
    expect(screen.getByLabelText('Voice two')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Undo the last swipe' }));
    expect(screen.getByLabelText('Voice one')).toBeInTheDocument();
    expect(screen.getByText('1 of 3')).toBeVisible();
  });

  it('judges with the arrow keys', () => {
    renderDeck();

    fireEvent.keyDown(screen.getByRole('region', { name: 'Review Pick the voices' }), { key: 'ArrowRight' });
    expect(screen.getByLabelText('Voice two')).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('region', { name: 'Review Pick the voices' }), { key: 'ArrowLeft' });
    expect(screen.getByRole('textbox', { name: 'Reason for disliking Voice two' })).toBeVisible();
  });

  it('judges with a swipe past the threshold and springs back short of it', () => {
    renderDeck();

    const card = () => screen.getByText(/^[A-C]$/).closest('.review-deck-card')!;
    fireEvent.pointerDown(card(), { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(card(), { clientX: 120, clientY: 104, pointerId: 1 });
    fireEvent.pointerUp(card(), { clientX: 120, clientY: 104, pointerId: 1 });
    expect(screen.getByText('1 of 3')).toBeVisible();

    fireEvent.pointerDown(card(), { clientX: 100, clientY: 100, pointerId: 2 });
    fireEvent.pointerMove(card(), { clientX: 200, clientY: 110, pointerId: 2 });
    fireEvent.pointerUp(card(), { clientX: 200, clientY: 110, pointerId: 2 });
    expect(screen.getByLabelText('Voice two')).toBeInTheDocument();
  });

  // With motion on, a voted card flies off its side first and is judged once it has gone.
  it('flies a voted card off before judging it', () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    renderDeck();

    const card = screen.getByText('A').closest<HTMLElement>('.review-deck-card')!;
    fireEvent.click(screen.getByRole('button', { name: 'Like' }));
    expect(card.style.transform).toMatch(/^translate\(\d+px, 0px\) rotate\(27deg\)$/);
    expect(screen.getByText('1 of 3')).toBeVisible();

    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByText('2 of 3')).toBeVisible();
  });

  it('shows the failure when the answer is refused, and tries again once a vote is cast again', async () => {
    answerStatus = 502;
    renderDeck();

    vote('Like');
    vote('Like');
    vote('Like');
    expect(await screen.findByRole('alert')).toHaveTextContent('The review did not send.');
    expect(answers()).toHaveLength(1);

    answerStatus = 200;
    fireEvent.click(screen.getByRole('button', { name: 'Undo the last swipe' }));
    vote('Like');

    await waitFor(() => expect(answers()).toHaveLength(2));
  });

  it('plays an audio card when it appears and again on a tap, and says how long it runs', () => {
    const played = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    renderDeck();

    const audio = document.querySelector('audio')!;
    expect(audio).toHaveAttribute('src', 'https://media.example.test/v1.wav');
    expect(played).toHaveBeenCalledTimes(1);
    expect(screen.getByText('0:02')).toBeVisible();

    const card = screen.getByLabelText('Voice one').closest('.review-deck-card')!;
    fireEvent.pointerDown(card, { clientX: 40, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(card, { clientX: 42, clientY: 41, pointerId: 1 });

    expect(played).toHaveBeenCalledTimes(2);
    // A tap on an audio card plays it; it never opens the full-screen viewer a still opens.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  // A phone only lets sound start from a gesture, so the next card's voice starts inside the vote itself.
  it('starts the next card’s voice inside the vote', () => {
    const played = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    renderDeck();
    const audio = document.querySelector('audio')!;
    let srcAtPlay: string | null = null;
    played.mockImplementation(() => {
      srcAtPlay = audio.getAttribute('src');
      return Promise.resolve();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Like' }));

    expect(srcAtPlay).toBe('https://media.example.test/v2.wav');
  });

  // #631: the Blobs voices deck showed portraits and played nothing. A character card plays its voice and shows its
  // portrait, and a tap replays the voice instead of opening the portrait.
  it('plays a character card’s voice beside its portrait', () => {
    const played = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    renderDeck(characterCommand());

    expect(screen.getByAltText('pip voice')).toHaveAttribute('src', 'https://media.example.test/pip.png');
    expect(document.querySelector('audio')).toHaveAttribute('src', 'https://media.example.test/pip.mp3');
    expect(screen.getByText('0:03')).toBeVisible();

    const card = screen.getByAltText('pip voice').closest('.review-deck-card')!;
    fireEvent.pointerDown(card, { clientX: 40, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(card, { clientX: 41, clientY: 41, pointerId: 1 });

    expect(played).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the whole still on the card and opens it full screen on a tap', () => {
    renderDeck(imageCommand());

    const still = screen.getByAltText('Mock one');
    // The card takes the sample's own shape so nothing is cropped; the stylesheet contains the image inside it.
    const card = still.closest<HTMLElement>('.review-deck-card')!;
    expect(card.style.getPropertyValue('--ar')).toBe(String(320 / 300));

    fireEvent.pointerDown(card, { clientX: 40, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(card, { clientX: 42, clientY: 41, pointerId: 1 });

    const viewer = screen.getByRole('dialog', { name: 'Mock one' });
    expect(viewer).toBeVisible();
    expect(viewer.querySelector('img')).toHaveAttribute('src', 'https://media.example.test/m1.png');
    expect(screen.getByText('1 of 3')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Mock one' })).not.toBeInTheDocument();
  });

  it('keeps the swipe a gesture, not a tap, so dragging a card never opens the viewer', () => {
    renderDeck(imageCommand());

    const card = screen.getByAltText('Mock one').closest('.review-deck-card')!;
    fireEvent.pointerDown(card, { clientX: 40, clientY: 40, pointerId: 1 });
    fireEvent.pointerMove(card, { clientX: 140, clientY: 42, pointerId: 1 });
    fireEvent.pointerUp(card, { clientX: 140, clientY: 42, pointerId: 1 });

    expect(screen.getByText('2 of 3')).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

// Three cards carrying stills of different shapes, so the whole-sample checks have something that would crop.
function imageCommand(overrides: Partial<GameCommand> = {}): GameCommand {
  return {
    job_id: 'j_2',
    ticket: '570',
    title: 'Pick the look',
    checkpoint_id: 'cp_2',
    decision_id: 'd_2',
    version: 1,
    question: 'Which look should the Blobs keep?',
    options: [
      { id: 'm1', label: 'Mock one', media: { url: 'https://media.example.test/m1.png', width: 320, height: 300 } },
      { id: 'm2', label: 'Mock two', media: { url: 'https://media.example.test/m2.png', width: 300, height: 300 } },
      { id: 'm3', label: 'Mock three', media: { url: 'https://media.example.test/m3.png', width: 320, height: 200 } },
    ],
    recommend: 'm2',
    blocking: true,
    pick: 'many',
    opened_at: '2026-11-04T10:00:00.000Z',
    ...overrides,
  };
}
