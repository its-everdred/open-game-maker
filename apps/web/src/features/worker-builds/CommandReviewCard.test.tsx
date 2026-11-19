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
  fireEvent.click(screen.getByRole('button', { name: 'View option B' }));
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

it('records the displayed option as disliked for a change request', async () => {
  render(
    <QueryClientProvider client={queryClient}>
      <CommandReviewCard command={command} onAnswered={() => {}} />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'More contrast' } });
  fireEvent.click(screen.getByRole('button', { name: 'View option B' }));
  fireEvent.click(screen.getByRole('button', { name: 'Send changes' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/games/g/commands/d/answer', {
      method: 'POST',
      json: {
        option_id: 'b',
        version: 2,
        change_request: true,
        review: { likes: [], dislikes: [{ option_id: 'b' }], notes: 'More contrast' },
      },
    }),
  );
});

it('includes an optional note when picking an option', async () => {
  render(
    <QueryClientProvider client={queryClient}>
      <CommandReviewCard command={command} onAnswered={() => {}} />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: '  Keep the blue  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Pick A: First' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/games/g/commands/d/answer', {
      method: 'POST',
      json: { option_id: 'a', version: 2, review: { likes: ['a'], dislikes: [], notes: 'Keep the blue' } },
    }),
  );
});

it('keeps the displayed option fixed while its answer is sending', async () => {
  let finish!: (value: unknown) => void;
  api.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(
    <QueryClientProvider client={queryClient}>
      <CommandReviewCard command={command} onAnswered={() => {}} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Pick A: First' }));
  expect(screen.getByRole('button', { name: 'View option B' })).toBeDisabled();
  expect(screen.getByLabelText('Note (optional)')).toBeDisabled();
  finish({ status: 'answered' });
  await screen.findByText(/Saved/);
});

it('offers every sound attached to an option', () => {
  const media = { url: '/first.mp3', width: 1, height: 1 };
  render(
    <QueryClientProvider client={queryClient}>
      <CommandReviewCard
        command={{
          ...command,
          options: [
            { ...command.options[0]!, audio: media, audioClips: [{ ...media, url: '/second.mp3' }] },
            command.options[1]!,
          ],
        }}
        onAnswered={() => {}}
      />
    </QueryClientProvider>,
  );
  expect(screen.getByLabelText('First audio')).toHaveAttribute('src', '/first.mp3');
  expect(screen.getByLabelText('First audio 2')).toHaveAttribute('src', '/second.mp3');
});

it('enlarges an option image without selecting it', () => {
  render(
    <QueryClientProvider client={queryClient}>
      <CommandReviewCard command={command} onAnswered={() => {}} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'First' }));
  expect(screen.getByRole('dialog', { name: 'Review image' })).toBeVisible();
  expect(api).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog', { name: 'Review image' })).toBeNull();
});

it('answers a core review without treating it as a game', async () => {
  const { game_id: gameId, game_title: gameTitle, ...core } = command;
  expect([gameId, gameTitle]).toEqual(['g', 'Game']);
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
