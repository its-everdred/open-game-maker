import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CreatorCommand } from '@ogm/contracts';

import { DecisionDeck } from './DecisionDeck';

const answers = vi.hoisted(() => ({ answerCommand: vi.fn(async () => undefined) }));
vi.mock('./commands', () => answers);
// The review deck is tested on its own; here it only has to report that its review was sent.
vi.mock('./ReviewDeck', () => ({
  isReviewDeck: (command: CreatorCommand) => command.options.every(({ media }) => media !== undefined),
  // It keeps the game it was first shown for, as the real deck keeps its likes and notes.
  ReviewDeck: function ReviewDeck({ command, onAnswered }: { command: CreatorCommand; onAnswered(): void }) {
    const [shownFor] = useState(command.game_id);
    return (
      <button type="button" data-shown-for={shownFor} onClick={onAnswered}>
        Send review
      </button>
    );
  },
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
  // Two games' aiur instances can hold the same decision id; the next game's review must not start with the last one's
  // likes and notes.
  it('starts a fresh review deck for the next game even when the decision ids match', async () => {
    const media = { url: 'https://media.example.test/a.png', width: 64, height: 64 };
    const review = (gameId: string): CreatorCommand => ({
      ...command('d1', gameId),
      options: [
        { id: 'a', label: 'Option A', media },
        { id: 'b', label: 'Option B', media },
      ],
    });
    const commands = [review('g_blobs'), review('g_castle')];
    render(<DecisionDeck commands={commands} first={commands[0]!} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Send review' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Next decision' }));

    expect(screen.getByRole('button', { name: 'Send review' })).toHaveAttribute('data-shown-for', 'g_castle');
  });

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

  // A refused answer (the decision was answered elsewhere, or moved on) must not trap the walk: the creator can retry
  // or move on to the next decision.
  it('keeps the decision open with a retry when the answer does not send, and still offers the next one', async () => {
    answers.answerCommand.mockRejectedValueOnce(new Error('offline'));
    const commands = [command('d1'), command('d2')];
    render(<DecisionDeck commands={commands} first={commands[0]!} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Option A' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That answer did not send. Try again.');
    expect(screen.getByRole('button', { name: 'Option A' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Next decision' }));
    expect(screen.getByRole('dialog', { name: 'Topic d2' })).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // The inbox refetches while an answer is sent; a decision answered elsewhere meanwhile drops out of it. The deck must
  // close rather than strand the creator on an answered decision with nothing to walk to.
  it('closes when the next decision was answered elsewhere while this answer was sending', async () => {
    const commands = [command('d1'), command('d2')];
    const onClose = vi.fn();
    const view = render(<DecisionDeck commands={commands} first={commands[0]!} onClose={onClose} />);
    answers.answerCommand.mockImplementationOnce(async () => {
      view.rerender(<DecisionDeck commands={[commands[0]!]} first={commands[0]!} onClose={onClose} />);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Option A' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  // An answer that lands after the creator closed the deck must not close the next deck they opened.
  it('does not close anything when an answer lands after the deck was closed', async () => {
    let land!: () => void;
    answers.answerCommand.mockImplementationOnce(
      () => new Promise<undefined>((resolve) => (land = () => resolve(undefined))),
    );
    const onClose = vi.fn();
    const view = render(<DecisionDeck commands={[command('d1')]} first={command('d1')} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Option A' }));
    view.unmount();
    land();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onClose).not.toHaveBeenCalled();
  });
});
