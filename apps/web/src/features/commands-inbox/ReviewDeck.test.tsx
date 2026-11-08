import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GameCommand, VoiceTarget } from '@ogm/contracts';

import { resetReviewDrafts } from './drafts';
import { ReviewDeck } from './ReviewDeck';
import type { DictationPort } from './voice-note';

const calls: Array<{ url: string; method: string; body: unknown }> = [];
let answerStatus = 200;

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

function renderDeck(
  command = deckCommand(),
  onAnswered = vi.fn(),
  props: { dictation?: DictationPort; voiceTarget?: VoiceTarget } = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    onAnswered,
    ...render(
      <QueryClientProvider client={client}>
        <ReviewDeck gameId="g_1" command={command} onAnswered={onAnswered} {...props} />
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  calls.length = 0;
  answerStatus = 200;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
      calls.push({ url, method, body });
      if (url.includes('/checkpoints/')) {
        return new Response(JSON.stringify(answerStatus === 200 ? { status: 'answered' } : { error: 'no' }), {
          status: answerStatus,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 });
    }),
  );
});

afterEach(() => {
  cleanup();
  resetReviewDrafts();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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

  it('opens a reason note on a dislike and keeps the words in the answer', async () => {
    renderDeck();

    fireEvent.click(screen.getByRole('button', { name: 'Dislike' }));
    const reason = await screen.findByRole('textbox', { name: 'Reason for disliking Voice one' });
    fireEvent.change(reason, { target: { value: 'too robotic' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add the reason' }));

    expect(screen.getByLabelText('Voice two')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Like' }));
    fireEvent.click(screen.getByRole('button', { name: 'Like' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Choose Voice two' }));

    await waitFor(() =>
      expect(calls).toContainEqual({
        url: '/api/v1/jobs/j_1/checkpoints/cp_1/answer',
        method: 'POST',
        body: {
          option_id: 'v2',
          review: { likes: ['v2', 'v3'], dislikes: [{ option_id: 'v1', reason: 'too robotic' }] },
        },
      }),
    );
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

  // Send is always on: a creator who has heard enough sends a half-judged deck, and the answer carries what was judged.
  it('sends a half-judged deck from the card view', async () => {
    const { onAnswered } = renderDeck();

    fireEvent.click(screen.getByRole('button', { name: 'Like' }));
    const send = screen.getByRole('button', { name: 'Send the review' });
    expect(send).toBeEnabled();
    fireEvent.click(send);

    await waitFor(() => expect(onAnswered).toHaveBeenCalled());
    expect(calls).toContainEqual({
      url: '/api/v1/jobs/j_1/checkpoints/cp_1/answer',
      method: 'POST',
      body: { option_id: 'v1', review: { likes: ['v1'], dislikes: [] } },
    });
  });

  // Moving to another question unmounts the deck; coming back must find the same votes, not a fresh deck, or the
  // creator loses work by looking at the next question.
  it('keeps the answer as a draft when the deck closes and reopens', () => {
    const first = renderDeck();
    fireEvent.click(screen.getByRole('button', { name: 'Like' }));
    fireEvent.click(screen.getByRole('button', { name: 'Like' }));
    first.unmount();

    renderDeck();
    expect(screen.getByText('3 of 3')).toBeVisible();
    expect(screen.getByLabelText('Voice three')).toBeInTheDocument();
  });

  // A Command reopened at a new version is a new question: an old draft never answers it.
  it('starts a fresh draft for a new version of the Command', () => {
    const first = renderDeck();
    fireEvent.click(screen.getByRole('button', { name: 'Like' }));
    first.unmount();

    renderDeck(deckCommand({ version: 4 }));
    expect(screen.getByText('1 of 3')).toBeVisible();
  });

  it('undoes the last swipe', () => {
    renderDeck();

    fireEvent.click(screen.getByRole('button', { name: 'Like' }));
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

  it('judges with a swipe', () => {
    renderDeck();

    const card = screen.getByLabelText('Voice one').closest('.review-deck-card')!;
    fireEvent.pointerDown(card, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(card, { clientX: 180, pointerId: 1 });
    fireEvent.pointerUp(card, { clientX: 180, pointerId: 1 });

    expect(screen.getByLabelText('Voice two')).toBeInTheDocument();
  });

  it('flips a card in the ending grid and sends the review', async () => {
    renderDeck(deckCommand({ pick: 'many' }));

    fireEvent.click(screen.getByRole('button', { name: 'Like' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dislike' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    fireEvent.click(screen.getByRole('button', { name: 'Like' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Dislike Voice one' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send the review' }));

    await waitFor(() =>
      expect(calls).toContainEqual({
        url: '/api/v1/jobs/j_1/checkpoints/cp_1/answer',
        method: 'POST',
        body: {
          option_id: 'v3',
          review: { likes: ['v3'], dislikes: [{ option_id: 'v1' }, { option_id: 'v2' }] },
        },
      }),
    );
  });

  it('leaves the deck in place when the answer is refused', async () => {
    answerStatus = 409;
    renderDeck(deckCommand({ pick: 'many' }));

    fireEvent.click(screen.getByRole('button', { name: 'Like' }));
    fireEvent.click(screen.getByRole('button', { name: 'Like' }));
    fireEvent.click(screen.getByRole('button', { name: 'Like' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send the review' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The review did not send. Try again.');
  });

  // The creator's set-level words: one optional note that applies to every card, sent beside the per-card votes.
  it('sends the whole-set notes beside the per-card votes', async () => {
    renderDeck(deckCommand({ pick: 'many' }));

    for (const label of ['Like', 'Like', 'Like']) fireEvent.click(screen.getByRole('button', { name: label }));
    fireEvent.change(await screen.findByLabelText('Anything else about the set?'), {
      target: { value: 'All too young for the Blobs.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send the review' }));

    await waitFor(() =>
      expect(calls).toContainEqual({
        url: '/api/v1/jobs/j_1/checkpoints/cp_1/answer',
        method: 'POST',
        body: {
          option_id: 'v1',
          review: { likes: ['v1', 'v2', 'v3'], dislikes: [], notes: 'All too young for the Blobs.' },
        },
      }),
    );
  });

  it('leaves the whole-set notes out of the answer when the creator said nothing extra', async () => {
    renderDeck(deckCommand({ pick: 'many' }));

    for (const label of ['Like', 'Like', 'Like']) fireEvent.click(screen.getByRole('button', { name: label }));
    fireEvent.change(await screen.findByLabelText('Anything else about the set?'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send the review' }));

    await waitFor(() =>
      expect(calls).toContainEqual({
        url: '/api/v1/jobs/j_1/checkpoints/cp_1/answer',
        method: 'POST',
        body: { option_id: 'v1', review: { likes: ['v1', 'v2', 'v3'], dislikes: [] } },
      }),
    );
  });

  // Where the app has voice support the set-level note can be spoken: the app's dictation writes into the same field.
  it('fills the whole-set notes from a voice note', async () => {
    const transcripts: Array<(value: { kind: 'partial' | 'final'; text: string }) => void> = [];
    const port: DictationPort = {
      pressStart: vi.fn(),
      pressEnd: vi.fn(),
      on: (event, listener) => {
        if (event === 'transcript')
          transcripts.push(listener as (value: { kind: 'partial' | 'final'; text: string }) => void);
        return () => {};
      },
    };
    renderDeck(deckCommand({ pick: 'many' }), vi.fn(), { dictation: port });

    for (const label of ['Like', 'Like', 'Like']) fireEvent.click(screen.getByRole('button', { name: label }));
    const mic = await screen.findByRole('button', { name: 'Hold to talk your notes for the whole set' });
    fireEvent.pointerDown(mic, { pointerId: 1 });
    expect(port.pressStart).toHaveBeenCalled();

    act(() => {
      for (const listener of transcripts) listener({ kind: 'final', text: 'All too young for the Blobs.' });
    });
    expect(screen.getByLabelText('Anything else about the set?')).toHaveValue('All too young for the Blobs.');

    fireEvent.pointerUp(mic, { pointerId: 1 });
    expect(port.pressEnd).toHaveBeenCalled();
  });

  it('shows no voice control when the app has no voice support for the Command', async () => {
    renderDeck(deckCommand({ pick: 'many' }));

    for (const label of ['Like', 'Like', 'Like']) fireEvent.click(screen.getByRole('button', { name: label }));

    expect(await screen.findByLabelText('Anything else about the set?')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Hold to talk your notes for the whole set' })).not.toBeInTheDocument();
  });

  it('offers a replay control on an audio card', () => {
    renderDeck();

    expect(screen.getByRole('button', { name: 'Replay Voice one' })).toBeVisible();
    expect(document.querySelector('audio')).toHaveAttribute('src', 'https://media.example.test/v1.wav');
    // The card says how long the sample runs, so a long take can be judged without playing all of it.
    expect(screen.getByText('0:02')).toBeVisible();
  });

  it('plays an audio card on a tap as well as on its replay control', () => {
    renderDeck();

    const audio = document.querySelector('audio')!;
    const played = vi.spyOn(audio, 'play');
    played.mockResolvedValue(undefined);

    const card = screen.getByLabelText('Voice one').closest('.review-deck-card')!;
    fireEvent.pointerDown(card, { clientX: 40, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(card, { clientX: 42, clientY: 41, pointerId: 1 });

    expect(played).toHaveBeenCalled();
    // A tap on an audio card plays it; it never opens the full-screen viewer a still opens.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the whole still on the card and opens it full screen on a tap', () => {
    renderDeck(imageCommand());

    const still = screen.getByAltText('Mock one');
    // The box takes the sample's own shape so nothing is cropped; the stylesheet contains the image inside it.
    expect(still.style.aspectRatio).toBe('320 / 300');

    const card = still.closest('.review-deck-card')!;
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
    fireEvent.pointerMove(card, { clientX: 120, clientY: 42, pointerId: 1 });
    fireEvent.pointerUp(card, { clientX: 120, clientY: 42, pointerId: 1 });

    expect(screen.getByText('2 of 3')).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows whole thumbnails in the ending grid that open the same full-screen view', () => {
    renderDeck(imageCommand({ pick: 'many' }));

    for (const label of ['Like', 'Like', 'Like']) {
      fireEvent.click(screen.getByRole('button', { name: label }));
    }

    const likes = screen.getByRole('list', { name: 'Likes' });
    expect(likes.querySelectorAll('img')).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: 'Open Mock two full screen' }));
    expect(screen.getByRole('dialog', { name: 'Mock two' })).toBeVisible();
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
