import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CreatorCommand } from '@ogm/contracts';

import { DecisionDeck } from './DecisionDeck';

const answers = vi.hoisted(() => ({ answerCommand: vi.fn(async () => undefined) }));
vi.mock('./commands', () => answers);
// The review deck is tested on its own; here it only has to report that its review was sent.
vi.mock('./ReviewDeck', () => ({
  isReviewDeck: (command: CreatorCommand) => command.options.every(({ media }) => media !== undefined),
  ReviewDeck: ({ onAnswered }: { onAnswered(): void }) => (
    <button type="button" onClick={onAnswered}>
      Send review
    </button>
  ),
}));

const command = (id: string, gameId = 'g_blobs'): CreatorCommand => ({
  game_id: gameId,
  game_title: 'Blobs',
  job_id: null,
  ticket: '12',
  title: `Question ${id}`,
  summary: `Topic ${id}`,
  checkpoint_id: id,
  decision_id: id,
  version: 1,
  question: `Which ${id}?`,
  options: [
    { id: 'a', label: 'Option A' },
    { id: 'b', label: 'Option B' },
  ],
  blocking: false,
  opened_at: '2026-11-08T10:00:00.000Z',
});

afterEach(() => {
  cleanup();
  answers.answerCommand.mockReset();
  answers.answerCommand.mockImplementation(async () => undefined);
});

// Kevin (2026-11-08): after answering one decision the deck offers the next and walks through the rest without going
// back to the list.
describe('DecisionDeck', () => {
  it('answers through the decision’s own game, then walks to the next open decision', async () => {
    const commands = [command('d1'), command('d2', 'g_castle'), command('d3')];
    const onClose = vi.fn();
    render(<DecisionDeck commands={commands} first={commands[1]!} onClose={onClose} />);

    expect(screen.getByRole('dialog', { name: 'Topic d2' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Next decision' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Option B' }));
    await screen.findByRole('button', { name: 'Next decision' });
    expect(answers.answerCommand).toHaveBeenCalledWith('g_castle', commands[1], 'b');

    fireEvent.click(screen.getByRole('button', { name: 'Next decision' }));
    expect(screen.getByRole('dialog', { name: 'Topic d1' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Option A' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Next decision' }));
    // d2 is already answered, so the walk skips it.
    expect(screen.getByRole('dialog', { name: 'Topic d3' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Option A' }));
    // The last open decision answered: the deck closes.
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(answers.answerCommand).toHaveBeenCalledTimes(3);
  });

  // A review deck shows its own sent state, so the modal stays open on it rather than closing under the creator.
  it('walks on from a review deck, and stays on it when it is the last decision', () => {
    const media = { url: 'https://media.example.test/a.png', width: 320, height: 320 };
    const review = {
      ...command('d_review'),
      options: [
        { id: 'a', label: 'Option A', media },
        { id: 'b', label: 'Option B', media },
      ],
    };
    const onClose = vi.fn();
    render(<DecisionDeck commands={[review, command('d2')]} first={review} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Send review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next decision' }));
    expect(screen.getByRole('dialog', { name: 'Topic d2' })).toBeVisible();

    cleanup();
    render(<DecisionDeck commands={[review]} first={review} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send review' }));
    expect(screen.queryByRole('button', { name: 'Next decision' })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  // Two games' instances can each hold a decision with the same id; answering one must not skip the other.
  it('tells apart two games’ decisions that share an id', async () => {
    const commands = [command('d1', 'g_blobs'), { ...command('d1', 'g_castle'), summary: 'Castle topic' }];
    render(<DecisionDeck commands={commands} first={commands[0]!} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Option A' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Next decision' }));

    expect(screen.getByRole('dialog', { name: 'Castle topic' })).toBeVisible();
  });

  it('keeps the decision open with a retry when the answer does not send', async () => {
    answers.answerCommand.mockRejectedValueOnce(new Error('offline'));
    const commands = [command('d1'), command('d2')];
    render(<DecisionDeck commands={commands} first={commands[0]!} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Option A' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That answer did not send. Try again.');
    expect(screen.queryByRole('button', { name: 'Next decision' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Option A' })).toBeEnabled();
  });
});
