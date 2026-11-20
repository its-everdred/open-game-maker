import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GameCommand } from '@ogm/contracts/browser';

import { resetReviewDrafts } from '../../features/commands-inbox/drafts';
import { ReviewChoice } from './ReviewChoice';

const answer = vi.fn(async (...args: unknown[]) => void args);
vi.mock('../../features/commands-inbox/commands', () => ({ answerCommand: (...args: unknown[]) => answer(...args) }));
const command: GameCommand = {
  job_id: null,
  ticket: '42',
  title: 'Pick a look',
  command_id: 'command',
  decision_id: 'decision',
  version: 1,
  question: 'Which?',
  options: [
    { id: 'red', label: 'Red' },
    { id: 'blue', label: 'Blue' },
  ],
  blocking: false,
  opened_at: '2026-11-13T00:00:00.000Z',
};
const multiCommand: GameCommand = { ...command, pick: 'many', options: [...command.options, { id: 'green', label: 'Green' }] };
afterEach(() => {
  resetReviewDrafts();
  answer.mockClear();
});

describe('review choices', () => {
  it('sends the selected letter and optional note to the command', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ReviewChoice gameId="g_1" command={command} />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'More contrast' } });
    fireEvent.click(screen.getByRole('button', { name: 'Choose B: Blue' }));
    await waitFor(() =>
      expect(answer).toHaveBeenCalledWith('g_1', command, 'blue', {
        likes: ['blue'],
        dislikes: [],
        notes: 'More contrast',
      }),
    );
  });

  it('sends every multi-pick verdict and per-option reason to the command', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ReviewChoice gameId="g_1" command={multiCommand} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getAllByText('Like')[0]!);
    fireEvent.click(screen.getAllByText('Like')[1]!);
    fireEvent.click(screen.getAllByText('Dislike')[2]!);
    fireEvent.change(screen.getByLabelText('Note for B (optional)'), { target: { value: 'Too dark' } });
    fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'Keep both' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send review' }));
    await waitFor(() =>
      expect(answer).toHaveBeenCalledWith('g_1', multiCommand, 'red', {
        likes: ['red', 'blue'],
        dislikes: [{ option_id: 'green' }],
        liked_notes: [{ option_id: 'blue', reason: 'Too dark' }],
        notes: 'Keep both',
      }),
    );
  });

  it('sends an empty verdict map and the note for None', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ReviewChoice gameId="g_1" command={multiCommand} />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'None fit' } });
    fireEvent.click(screen.getByRole('button', { name: 'None' }));
    await waitFor(() =>
      expect(answer).toHaveBeenCalledWith('g_1', multiCommand, 'red', {
        likes: [],
        dislikes: [],
        notes: 'None fit',
      }),
    );
  });

  it('sends a note attached to a liked option', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ReviewChoice gameId="g_1" command={multiCommand} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getAllByText('Like')[0]!);
    fireEvent.change(screen.getByLabelText('Note for A (optional)'), { target: { value: 'Favorite color' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send review' }));
    await waitFor(() =>
      expect(answer).toHaveBeenCalledWith('g_1', multiCommand, 'red', {
        likes: ['red'],
        dislikes: [],
        liked_notes: [{ option_id: 'red', reason: 'Favorite color' }],
      }),
    );
  });
});
