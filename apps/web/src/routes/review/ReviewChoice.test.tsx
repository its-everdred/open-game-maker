import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GameCommand } from '@ogm/contracts/browser';

import { resetReviewDrafts } from '../../features/commands-inbox/drafts';
import { ReviewChoice } from './ReviewChoice';

const answer = vi.fn(async () => undefined);
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
});
