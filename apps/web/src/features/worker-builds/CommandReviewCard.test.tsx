import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../../app/query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { CreatorCommand } from '@ogm/contracts';
import { CommandReviewCard } from './CommandReviewCard';

const api = vi.hoisted(() => vi.fn().mockResolvedValue({ status: 'answered' }));
vi.mock('../../lib/api/client', () => ({ api }));
afterEach(() => {
  cleanup();
  queryClient.clear();
  api.mockClear();
});
const command: CreatorCommand = {
  game_id: 'g',
  game_title: 'Game',
  job_id: 'j',
  ticket: '12',
  title: 'Choose',
  command_id: 'c',
  decision_id: 'd',
  version: 2,
  question: 'Which?',
  blocking: true,
  opened_at: '2026-01-01T00:00:00Z',
  options: [
    { id: 'a', label: 'First', media: { url: '/a.png', width: 100, height: 100 } },
    { id: 'b', label: 'Second', media: { url: '/b.png', width: 100, height: 100 } },
  ],
};
it('sends a pick through the creator answer route and shows it was saved', async () => {
  const answered = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <CommandReviewCard command={command} onAnswered={answered} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Pick B: Second' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/games/g/commands/d/answer', {
      method: 'POST',
      json: { option_id: 'b', version: 2, review: { likes: ['b'], dislikes: [] } },
    }),
  );
  expect(await screen.findByText(/Saved/)).toBeVisible();
  expect(answered).toHaveBeenCalledOnce();
});

it('requires an explicit option for a change request and records it as disliked', async () => {
  render(
    <QueryClientProvider client={queryClient}>
      <CommandReviewCard command={command} onAnswered={() => {}} />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText('Change this'), { target: { value: 'More contrast' } });
  expect(screen.getByRole('button', { name: 'Send changes' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Option to change'), { target: { value: 'b' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send changes' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/games/g/commands/d/answer', {
      method: 'POST',
      json: {
        option_id: 'b',
        version: 2,
        review: { likes: [], dislikes: [{ option_id: 'b' }], notes: 'More contrast' },
      },
    }),
  );
});

it('answers a core review without treating it as a game', async () => {
  const { game_id: _gameId, game_title: _gameTitle, ...core } = command;
  render(
    <QueryClientProvider client={queryClient}>
      <CommandReviewCard command={{ ...core, source: 'core' }} onAnswered={() => {}} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Pick A: First' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/core/commands/d/answer', expect.objectContaining({ method: 'POST' })),
  );
});
