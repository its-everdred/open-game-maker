import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import type { GameCommand } from '@ogm/contracts';

import { markSent, resetReviewDrafts, useDeckDraft } from './drafts';
import { ReviewRows } from './ReviewRows';

function command(overrides: Partial<GameCommand> = {}): GameCommand {
  return {
    job_id: 'j_1',
    ticket: '478',
    title: 'Pick the voices',
    command_id: 'cp_1',
    decision_id: 'd_1',
    version: 1,
    question: 'Which voices should Blobs use?',
    options: [
      { id: 'm1', label: 'Mock one', media: { url: 'https://media.example.test/m1.png', width: 320, height: 320 } },
      { id: 'm2', label: 'Mock two', media: { url: 'https://media.example.test/m2.png', width: 320, height: 320 } },
    ],
    recommend: 'm1',
    blocking: true,
    opened_at: '2026-11-04T10:00:00.000Z',
    review_number: 1,
    ...overrides,
  };
}

// Judges one card of a Command's draft the way the deck does, without rendering the deck.
function Judge({ of }: { of: GameCommand }) {
  const [, dispatch] = useDeckDraft(of);
  return (
    <button type="button" onClick={() => dispatch({ type: 'judge', optionId: 'm1', verdict: 'like' })}>
      judge
    </button>
  );
}

afterEach(() => {
  cleanup();
  resetReviewDrafts();
});

describe('ReviewRows', () => {
  // The inbox tells the creator at a glance which questions still need them: untouched, started or already sent.
  it('shows each question with its first sample, a short title and its open, draft or sent state', () => {
    const open = command();
    const started = command({ command_id: 'cp_2', title: 'Pick the look', review_number: 2 });
    const sent = command({ command_id: 'cp_3', title: 'Pick the music', review_number: 3 });
    render(
      <MemoryRouter>
        <ReviewRows commands={[open, started, sent]} hrefOf={(c) => `/blobs/review/${c.review_number}`} />
        <Judge of={started} />
      </MemoryRouter>,
    );

    act(() => screen.getByRole('button', { name: 'judge' }).click());
    act(() => markSent(sent));

    expect(screen.getByRole('link', { name: 'Pick the voices, open' })).toHaveAttribute('href', '/blobs/review/1');
    expect(screen.getByRole('link', { name: 'Pick the look, draft' })).toHaveAttribute('href', '/blobs/review/2');
    expect(screen.getByRole('link', { name: 'Pick the music, sent' })).toHaveAttribute('href', '/blobs/review/3');
    const thumb = screen.getByRole('link', { name: 'Pick the voices, open' }).querySelector('.review-row-thumb img');
    expect(thumb).toHaveAttribute('src', 'https://media.example.test/m1.png');
  });

  it('cuts a long title to a few words', () => {
    render(
      <MemoryRouter>
        <ReviewRows
          commands={[command({ title: 'Which of these two voices should the Blobs use for idle chatter?' })]}
          hrefOf={() => '/blobs/review/1'}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Which of these two voices…, open' })).toBeInTheDocument();
  });

  it('badges the generated asset represented by a row thumbnail', () => {
    render(
      <MemoryRouter>
        <ReviewRows
          commands={[
            command({
              options: [
                {
                  id: 'm1',
                  label: 'Generated mock',
                  media: { url: 'https://media.example.test/generated.png', width: 320, height: 320 },
                  aiGenerated: true,
                },
                { id: 'm2', label: 'Authored mock' },
              ],
            }),
          ]}
          hrefOf={() => '/blobs/review/1'}
        />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText('AI-generated')).toHaveTextContent('AI');
    expect(screen.getByRole('link', { name: 'Pick the voices, open, AI-generated' })).toBeVisible();
  });

  // An aiur clip may name its kind and carry no poster: its row shows the clip's first frame, never an image tag
  // pointing at an mp4 (a broken picture in the row). A link in the title never shows as text.
  it('shows a posterless clip as a clip and drops links from the title', () => {
    const clip = { url: 'https://media.example.test/roll.mp4', width: 64, height: 48, kind: 'video' as const };
    render(
      <MemoryRouter>
        <ReviewRows
          commands={[
            command({
              title: 'Pick the roll https://example.test/x',
              options: [
                { id: 'm1', label: 'Roll', media: clip },
                { id: 'm2', label: 'Flat', media: clip },
              ],
            }),
          ]}
          hrefOf={() => '/blobs/review/1'}
        />
      </MemoryRouter>,
    );
    const row = screen.getByRole('link', { name: 'Pick the roll, open' });
    expect(row.querySelector('.review-row-thumb video')).toHaveAttribute('src', 'https://media.example.test/roll.mp4');
    expect(row.querySelector('.review-row-thumb img')).toBeNull();
  });
});
