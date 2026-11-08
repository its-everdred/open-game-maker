import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GameCommand } from '@ogm/contracts';

import type { GameFrameState, MountGameFrameOptions } from '../editor/frame';
import { resetReviewDrafts } from './drafts';
import { ReviewDeck } from './ReviewDeck';

// A gameplay-feel question (#608) is answered by playing each option, so the deck runs a slice of the game in the card
// instead of showing a link. The frame itself is the host's; these tests stand in for it and check what the deck asks
// of it: which build and scenario, when it pauses, and what plays next.
const mounts: Array<{ options: MountGameFrameOptions; pause: ReturnType<typeof vi.fn>; disposed: boolean }> = [];

vi.mock('../editor/frame', () => ({
  mountGameFrame: (options: MountGameFrameOptions) => {
    const mount = { options, pause: vi.fn(), disposed: false };
    mounts.push(mount);
    return { pause: mount.pause, dispose: () => (mount.disposed = true) };
  },
}));

function fallSpeedCommand(): GameCommand {
  return {
    job_id: 'j_1',
    ticket: '608',
    title: 'Fall speed',
    checkpoint_id: 'cp_1',
    decision_id: 'd_1',
    version: 1,
    question: 'Which fall speed feels right?',
    options: [
      { id: 'slow', label: 'Slow', playable: { scenario: 'scenario=sandbox&speed=slow', seconds: 8 } },
      {
        id: 'medium',
        label: 'Medium',
        playable: { scenario: 'scenario=sandbox&speed=medium', seconds: 5, lead_in: 'one-chain' },
      },
      { id: 'fast', label: 'Fast', playable: { scenario: 'scenario=sandbox&speed=fast', seconds: 4, branch: 'feel' } },
    ],
    recommend: 'medium',
    blocking: false,
    opened_at: '2026-11-07T18:10:00.000Z',
  };
}

const designUrls: string[] = [];

beforeEach(() => {
  mounts.length = 0;
  designUrls.length = 0;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      designUrls.push(url);
      return new Response(JSON.stringify({ rev: 1, buildId: 'b_live', doc: { entities: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
});

afterEach(() => {
  cleanup();
  resetReviewDrafts();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function ready(index: number) {
  act(() => mounts[index]!.options.onState?.({ bridgeState: 'ready', dropped: 0 } satisfies GameFrameState));
}

async function renderDeck() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ReviewDeck gameId="g_1" command={fallSpeedCommand()} />
    </QueryClientProvider>,
  );
  await advance(0);
}

describe('playable review cards', () => {
  it('plays the first option’s scenario on the game’s build, pauses after its seconds, then starts the next', async () => {
    await renderDeck();

    expect(mounts).toHaveLength(1);
    expect(mounts[0]!.options).toMatchObject({
      gameId: 'g_1',
      buildId: 'b_live',
      mode: 'play',
      params: { scenario: 'sandbox', speed: 'slow' },
    });
    expect(designUrls[0]).toContain('/branches/main/design');

    // The slice counts from the moment the game is ready, not from the mount.
    await advance(10_000);
    expect(mounts[0]!.pause).not.toHaveBeenCalled();
    ready(0);
    await advance(7_900);
    expect(mounts[0]!.pause).not.toHaveBeenCalled();
    await advance(100);
    expect(mounts[0]!.pause).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Play Slow again' })).toBeTruthy();

    // Judging moves on, and the next option's slice starts on its own with its lead-in move.
    fireEvent.click(screen.getByRole('button', { name: 'Like' }));
    await advance(0);
    expect(mounts[0]!.disposed).toBe(true);
    expect(mounts.at(-1)!.options.params).toEqual({ scenario: 'sandbox', speed: 'medium', lead_in: 'one-chain' });
    // The new card plays: the last card's pause and "play again" do not carry over to it.
    expect(screen.queryByRole('button', { name: 'Play Medium again' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Compare every option' })).toBeNull();
  });

  it('plays an option that also carries a still, instead of showing the still', async () => {
    const command = fallSpeedCommand();
    command.options[0] = {
      ...command.options[0]!,
      media: { url: 'https://media.example.test/s.png', width: 4, height: 3 },
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReviewDeck gameId="g_1" command={command} />
      </QueryClientProvider>,
    );
    await advance(0);

    expect(mounts).toHaveLength(1);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('says the game did not load and never pauses a game that never started', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'nope' }), { status: 500 })),
    );
    await renderDeck();
    await advance(0);

    expect(mounts).toHaveLength(0);
    expect(screen.getByRole('status').textContent).toBe('The game did not load.');
  });

  it('replays the same slice from the start on play again', async () => {
    await renderDeck();
    ready(0);
    await advance(8_000);

    fireEvent.click(screen.getByRole('button', { name: 'Play Slow again' }));
    await advance(0);

    expect(mounts[0]!.disposed).toBe(true);
    expect(mounts).toHaveLength(2);
    expect(mounts[1]!.options.params).toEqual({ scenario: 'sandbox', speed: 'slow' });
    expect(screen.queryByRole('button', { name: 'Play Slow again' })).toBeNull();
  });

  it('compares every option in turn, each for its own seconds, naming the one on screen', async () => {
    await renderDeck();
    ready(0);
    await advance(8_000);

    fireEvent.click(screen.getByRole('button', { name: 'Compare every option' }));
    await advance(0);
    expect(mounts.at(-1)!.options.params).toMatchObject({ speed: 'slow' });
    expect(screen.getAllByText('Slow')).toHaveLength(2);

    ready(mounts.length - 1);
    await advance(8_000);
    expect(mounts.at(-1)!.options.params).toMatchObject({ speed: 'medium' });
    expect(screen.getByText('Medium')).toBeTruthy();

    ready(mounts.length - 1);
    await advance(5_000);
    await advance(0);
    // The last option plays the build of its own branch.
    expect(mounts.at(-1)!.options.params).toMatchObject({ speed: 'fast' });
    expect(designUrls.at(-1)).toContain('/branches/feel/design');

    ready(mounts.length - 1);
    await advance(4_000);
    expect(mounts.at(-1)!.pause).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Play Slow again' })).toBeTruthy();
    // Comparing is a look, not a verdict: the deck is still on its first card.
    expect(screen.getByText('1 of 3')).toBeTruthy();
  });
});
