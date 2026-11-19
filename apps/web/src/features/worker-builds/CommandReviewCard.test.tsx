import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../../app/query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  expect(api).not.toHaveBeenCalled();
  fireEvent.click(
    within(screen.getByRole('dialog', { name: 'Pick B: Second' })).getByRole('button', { name: 'Send choice' }),
  );
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
  fireEvent.click(screen.getByRole('button', { name: 'Pick A: First' }));
  const sheet = within(screen.getByRole('dialog', { name: 'Pick A: First' }));
  fireEvent.change(sheet.getByLabelText('Note (optional)'), { target: { value: '  Keep the blue  ' } });
  fireEvent.click(sheet.getByRole('button', { name: 'Send choice' }));
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
  fireEvent.click(
    within(screen.getByRole('dialog', { name: 'Pick A: First' })).getByRole('button', { name: 'Send choice' }),
  );
  expect(screen.getByRole('button', { name: 'View option B' })).toBeDisabled();
  expect(
    within(screen.getByRole('dialog', { name: 'Pick A: First' })).getByLabelText('Note (optional)'),
  ).toBeDisabled();
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
  fireEvent.click(
    within(screen.getByRole('dialog', { name: 'Pick A: First' })).getByRole('button', { name: 'Send choice' }),
  );
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/core/commands/d/answer', expect.objectContaining({ method: 'POST' })),
  );
});

it('does not send when a creator cancels the choice note', () => {
  render(
    <QueryClientProvider client={queryClient}>
      <CommandReviewCard command={command} onAnswered={() => {}} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Pick A: First' }));
  fireEvent.click(
    within(screen.getByRole('dialog', { name: 'Pick A: First' })).getByRole('button', { name: 'Cancel' }),
  );
  expect(api).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog', { name: 'Pick A: First' })).toBeNull();
});

it('keeps the chosen option and note available when sending fails', async () => {
  api.mockRejectedValueOnce(new Error('offline'));
  render(
    <QueryClientProvider client={queryClient}>
      <CommandReviewCard command={command} onAnswered={() => {}} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'View option B' }));
  fireEvent.click(screen.getByRole('button', { name: 'Pick B: Second' }));
  const sheet = within(screen.getByRole('dialog', { name: 'Pick B: Second' }));
  fireEvent.change(sheet.getByLabelText('Note (optional)'), { target: { value: 'Keep blue' } });
  fireEvent.click(sheet.getByRole('button', { name: 'Send choice' }));
  expect(await sheet.findByRole('alert')).toHaveTextContent('That answer did not send');
  expect(sheet.getByLabelText('Note (optional)')).toHaveValue('Keep blue');
  fireEvent.click(sheet.getByRole('button', { name: 'Send choice' }));
  await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
  expect(api).toHaveBeenLastCalledWith(
    '/games/g/commands/d/answer',
    expect.objectContaining({
      json: expect.objectContaining({ option_id: 'b', review: expect.objectContaining({ notes: 'Keep blue' }) }),
    }),
  );
});

it('pages option media with a horizontal swipe without submitting a choice', () => {
  render(
    <QueryClientProvider client={queryClient}>
      <CommandReviewCard command={command} onAnswered={() => {}} />
    </QueryClientProvider>,
  );
  const first = screen.getByAltText('First');
  fireEvent.pointerDown(first, { pointerId: 1, clientX: 180, clientY: 40, isPrimary: true });
  fireEvent.pointerUp(first, { pointerId: 1, clientX: 60, clientY: 40 });
  expect(screen.getByRole('button', { name: 'View option B' })).toHaveAttribute('aria-pressed', 'true');
  const second = screen.getByAltText('Second');
  fireEvent.pointerDown(second, { pointerId: 2, clientX: 60, clientY: 40, isPrimary: true });
  fireEvent.pointerUp(second, { pointerId: 2, clientX: 180, clientY: 40 });
  expect(screen.getByRole('button', { name: 'View option A' })).toHaveAttribute('aria-pressed', 'true');
  expect(api).not.toHaveBeenCalled();
});

it('leaves the option in place for vertical scrolling or a two-finger gesture', () => {
  render(
    <QueryClientProvider client={queryClient}>
      <CommandReviewCard command={command} onAnswered={() => {}} />
    </QueryClientProvider>,
  );
  const image = screen.getByAltText('First');
  fireEvent.pointerDown(image, { pointerId: 1, clientX: 180, clientY: 40, isPrimary: true });
  fireEvent.pointerUp(image, { pointerId: 1, clientX: 150, clientY: 160 });
  expect(screen.getByRole('button', { name: 'View option A' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.pointerDown(image, { pointerId: 1, clientX: 180, clientY: 40, isPrimary: true });
  fireEvent.pointerDown(image, { pointerId: 2, clientX: 170, clientY: 40, isPrimary: false });
  fireEvent.pointerUp(image, { pointerId: 1, clientX: 60, clientY: 40 });
  expect(screen.getByRole('button', { name: 'View option A' })).toHaveAttribute('aria-pressed', 'true');
});
