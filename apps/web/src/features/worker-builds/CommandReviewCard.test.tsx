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
const sendButton = () => screen.getByText('Send', { selector: 'button' });
it('sends a pick through the creator answer route and shows it was saved', async () => {
  const answered = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <CommandReviewCard command={command} onAnswered={answered} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'View option B' }));
  fireEvent.click(screen.getByRole('button', { name: '👍' }));
  fireEvent.click(sendButton());
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
  fireEvent.click(screen.getByRole('button', { name: '👎' }));
  fireEvent.change(screen.getByLabelText('Note for B (optional)'), { target: { value: 'Too dark' } });
  fireEvent.click(sendButton());
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/games/g/commands/d/answer', {
      method: 'POST',
      json: {
        option_id: 'a',
        version: 2,
        review: { likes: [], dislikes: [{ option_id: 'b', reason: 'Too dark' }], notes: 'More contrast' },
      },
    }),
  );
});

it('likes multiple options and includes per-option like notes', async () => {
  render(
    <QueryClientProvider client={queryClient}>
      <CommandReviewCard command={command} onAnswered={() => {}} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: '👍' }));
  fireEvent.change(screen.getByLabelText('Note for A (optional)'), { target: { value: 'Keep blue' } });
  fireEvent.click(screen.getByRole('button', { name: 'View option B' }));
  fireEvent.click(screen.getByRole('button', { name: '👍' }));
  fireEvent.click(sendButton());
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/games/g/commands/d/answer', {
      method: 'POST',
      json: {
        option_id: 'a',
        version: 2,
        review: { likes: ['a', 'b'], dislikes: [], liked_notes: [{ option_id: 'a', reason: 'Keep blue' }] },
      },
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
  fireEvent.click(screen.getByRole('button', { name: '👍' }));
  fireEvent.click(sendButton());
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

it('answers a core review with the multi-vote payload', async () => {
  const { game_id: gameId, game_title: gameTitle, ...core } = command;
  expect([gameId, gameTitle]).toEqual(['g', 'Game']);
  render(
    <QueryClientProvider client={queryClient}>
      <CommandReviewCard command={{ ...core, source: 'core' }} onAnswered={() => {}} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: '👎' }));
  fireEvent.change(screen.getByLabelText('Note for A (optional)'), { target: { value: 'Too loud' } });
  fireEvent.click(sendButton());
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/core/commands/d/answer', {
      method: 'POST',
      json: { option_id: 'a', version: 2, review: { likes: [], dislikes: [{ option_id: 'a', reason: 'Too loud' }] } },
    }),
  );
});

it('sends None of these as dislikes for every option', async () => {
  render(
    <QueryClientProvider client={queryClient}>
      <CommandReviewCard command={command} onAnswered={() => {}} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'None of these' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/games/g/commands/d/answer', {
      method: 'POST',
      json: { option_id: 'a', version: 2, review: { likes: [], dislikes: [{ option_id: 'a' }, { option_id: 'b' }] } },
    }),
  );
});

it('sends a note-only answer and shows the recommendation only when set', async () => {
  const { rerender } = render(
    <QueryClientProvider client={queryClient}>
      <CommandReviewCard command={command} onAnswered={() => {}} />
    </QueryClientProvider>,
  );
  expect(screen.queryByText(/Recommended:/)).toBeNull();
  fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'A little brighter' } });
  fireEvent.click(sendButton());
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      '/games/g/commands/d/answer',
      expect.objectContaining({
        json: { option_id: 'a', version: 2, review: { likes: [], dislikes: [], notes: 'A little brighter' } },
      }),
    ),
  );
  rerender(
    <QueryClientProvider client={queryClient}>
      <CommandReviewCard command={{ ...command, version: 3, recommend: 'b' }} onAnswered={() => {}} />
    </QueryClientProvider>,
  );
  expect(screen.getByText('Recommended: B: Second')).toBeVisible();
});

it('keeps the chosen option and note available when sending fails', async () => {
  api.mockRejectedValueOnce(new Error('offline'));
  render(
    <QueryClientProvider client={queryClient}>
      <CommandReviewCard command={command} onAnswered={() => {}} />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'Keep blue' } });
  fireEvent.click(screen.getByRole('button', { name: 'View option B' }));
  fireEvent.click(screen.getByRole('button', { name: '👎' }));
  fireEvent.change(screen.getByLabelText('Note for B (optional)'), { target: { value: 'Too dark' } });
  fireEvent.click(sendButton());
  expect(await screen.findByRole('alert')).toHaveTextContent('That answer did not send');
  expect(screen.getByLabelText('Note (optional)')).toHaveValue('Keep blue');
  fireEvent.click(sendButton());
  await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
  expect(api).toHaveBeenLastCalledWith(
    '/games/g/commands/d/answer',
    expect.objectContaining({
      json: expect.objectContaining({
        option_id: 'a',
        review: expect.objectContaining({
          likes: [],
          dislikes: [{ option_id: 'b', reason: 'Too dark' }],
          notes: 'Keep blue',
        }),
      }),
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

const media = (name: string) => ({ url: `https://cdn.test/${name}.png`, width: 100, height: 100 });
const layoutCommand: CreatorCommand = {
  ...command,
  options: [
    // Listed out of pipeline order: the card must still read Original | 3D | 2D.
    { id: 'knight-2d', label: 'Knight sprite', media: media('k2'), layout: { row: 'Knight', stage: '2d' } },
    { id: 'knight-og', label: 'Knight pack', media: media('k0'), layout: { row: 'Knight', stage: 'original' } },
    { id: 'knight-3d', label: 'Knight model', media: media('k3'), layout: { row: 'Knight', stage: '3d' } },
    { id: 'tree-a', label: 'Tree A', media: media('ta'), layout: { row: 'Tree' } },
    { id: 'tree-og', label: 'Tree pack', media: media('t0'), layout: { row: 'Tree', stage: 'original' } },
  ],
};

it('lays out row-tagged options as a matrix and sends its votes as the review', async () => {
  render(
    <QueryClientProvider client={queryClient}>
      <CommandReviewCard command={layoutCommand} onAnswered={() => {}} />
    </QueryClientProvider>,
  );
  expect(screen.queryByRole('button', { name: 'View option A' })).toBeNull();
  const knight = screen.getByRole('region', { name: 'Knight' });
  expect([...knight.querySelectorAll('img')].map((image) => image.alt)).toEqual([
    'Knight pack',
    'Knight model',
    'Knight sprite',
  ]);
  const tree = screen.getByRole('region', { name: 'Tree' });
  expect(tree.querySelector('img')?.alt).toBe('Tree pack');
  // An original is there to compare against, not to judge.
  expect(screen.queryByRole('button', { name: 'Like Knight pack' })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Like Knight model' }));
  fireEvent.click(screen.getByRole('button', { name: 'Dislike Knight sprite' }));
  fireEvent.click(screen.getByRole('button', { name: 'Enlarge Knight sprite' }));
  const enlarged = screen.getByRole('dialog', { name: 'Knight sprite' });
  // The enlarged candidate keeps its original beside it.
  expect([...enlarged.querySelectorAll('img')].map((image) => image.alt)).toEqual(['Knight pack', 'Knight sprite']);
  fireEvent.change(screen.getByRole('textbox', { name: 'Note for Knight sprite' }), {
    target: { value: 'Outline too thin' },
  });
  fireEvent.click(sendButton());
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/games/g/commands/d/answer', {
      method: 'POST',
      json: {
        option_id: 'knight-3d',
        version: 2,
        review: { likes: ['knight-3d'], dislikes: [{ option_id: 'knight-2d', reason: 'Outline too thin' }] },
      },
    }),
  );
});

it('never sends an original as rejected when none of the candidates fit', async () => {
  render(
    <QueryClientProvider client={queryClient}>
      <CommandReviewCard command={layoutCommand} onAnswered={() => {}} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'None of these' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/games/g/commands/d/answer', {
      method: 'POST',
      json: {
        option_id: 'knight-2d',
        version: 2,
        review: {
          likes: [],
          dislikes: [{ option_id: 'knight-2d' }, { option_id: 'knight-3d' }, { option_id: 'tree-a' }],
        },
      },
    }),
  );
});

it('shows how each image was made under it, in the card and the matrix', () => {
  const meta = { kind: 'image generation' as const, model: 'gpt-image-1', cost_usd: 0.04, ai_generated: true };
  const { unmount } = render(
    <QueryClientProvider client={queryClient}>
      <CommandReviewCard
        command={{ ...command, options: [{ ...command.options[0]!, meta }, command.options[1]!] }}
        onAnswered={() => {}}
      />
    </QueryClientProvider>,
  );
  expect(screen.getByText('image generation · gpt-image-1 · $0.04 · AI')).toBeVisible();
  unmount();
  render(
    <QueryClientProvider client={queryClient}>
      <CommandReviewCard
        command={{
          ...layoutCommand,
          options: layoutCommand.options.map((option) =>
            option.id === 'knight-og'
              ? { ...option, meta: { kind: 'pack original' as const, cost_usd: null } }
              : option,
          ),
        }}
        onAnswered={() => {}}
      />
    </QueryClientProvider>,
  );
  expect(screen.getByText('pack original · free')).toBeVisible();
});

it('answers and follows a PC-daemon Command on the PC daemon', async () => {
  const { game_id: gameId, game_title: gameTitle, ...core } = command;
  expect([gameId, gameTitle]).toEqual(['g', 'Game']);
  render(
    <QueryClientProvider client={queryClient}>
      <CommandReviewCard command={{ ...core, source: 'core', daemon: 'pc' }} onAnswered={() => {}} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: '👍' }));
  fireEvent.click(sendButton());
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/core/commands/d/answer?daemon=pc', {
      method: 'POST',
      json: { option_id: 'a', version: 2, review: { likes: ['a'], dislikes: [] } },
    }),
  );
  await waitFor(() => expect(api).toHaveBeenCalledWith('/core/tickets/12/state?daemon=pc'));
});

it('keeps the original beside an enlarged candidate after a vote', () => {
  render(
    <QueryClientProvider client={queryClient}>
      <CommandReviewCard command={layoutCommand} onAnswered={() => {}} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Enlarge Knight model' }));
  const enlarged = screen.getByRole('dialog', { name: 'Knight model' });
  fireEvent.click(enlarged.querySelector('button[aria-label="Like Knight model"]')!);
  expect([...enlarged.querySelectorAll('img')].map((image) => image.alt)).toEqual(['Knight pack', 'Knight model']);
});

it('keeps a row deck that carries audio on the paged card, which can play it', () => {
  render(
    <QueryClientProvider client={queryClient}>
      <CommandReviewCard
        command={{
          ...layoutCommand,
          options: layoutCommand.options.map((option, index) =>
            index === 0 ? { ...option, audio: { url: 'https://cdn.test/k2.mp3', width: 0, height: 0 } } : option,
          ),
        }}
        onAnswered={() => {}}
      />
    </QueryClientProvider>,
  );
  expect(screen.getByRole('button', { name: 'View option A' })).toBeVisible();
  expect(screen.getByLabelText('Knight sprite audio')).toBeInTheDocument();
});

it('shows an original on the paged card without asking for a verdict on it', () => {
  // One option without media sends the row deck to the paged card.
  const options = layoutCommand.options.map((option) =>
    option.id === 'tree-a' ? { id: option.id, label: option.label, layout: option.layout } : option,
  );
  render(
    <QueryClientProvider client={queryClient}>
      <CommandReviewCard command={{ ...layoutCommand, options }} onAnswered={() => {}} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'View option B' }));
  expect(screen.getByAltText('Knight pack')).toBeVisible();
  expect(screen.queryByRole('button', { name: /^Pick B/ })).toBeNull();
  expect(screen.queryByLabelText(/Rate B/)).toBeNull();
});

it('closes an enlarged candidate when a new round of the Command arrives', () => {
  const view = render(
    <QueryClientProvider client={queryClient}>
      <CommandReviewCard command={layoutCommand} onAnswered={() => {}} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Enlarge Knight sprite' }));
  const note = screen.getByRole('textbox', { name: 'Note for Knight sprite' });
  // The card rejects option notes over 1,000 characters, so the matrix cannot take more.
  expect(note).toHaveAttribute('maxLength', '1000');
  fireEvent.change(note, { target: { value: 'Too thin' } });
  view.rerender(
    <QueryClientProvider client={queryClient}>
      <CommandReviewCard command={{ ...layoutCommand, version: 3 }} onAnswered={() => {}} />
    </QueryClientProvider>,
  );
  expect(screen.queryByRole('dialog', { name: 'Knight sprite' })).toBeNull();
});
