import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommandsInbox } from './CommandsInbox';
import { commandFixture } from './fixtures';

const calls: Array<{ url: string; method: string; body: unknown }> = [];
let commands = [commandFixture()];
let answerStatus = 200;

function renderInbox(onOpenJob = vi.fn(), slug?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    onOpenJob,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CommandsInbox gameId="g_1" slug={slug} onOpenJob={onOpenJob} />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  calls.length = 0;
  commands = [commandFixture()];
  answerStatus = 200;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
      calls.push({ url, method, body });
      if (url.endsWith('/api/v1/games/g_1/commands')) {
        return new Response(JSON.stringify({ commands }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/checkpoints/')) {
        return new Response(JSON.stringify(answerStatus === 200 ? { status: 'answered' } : { error: 'no' }), {
          status: answerStatus,
          headers: { 'content-type': 'application/json' },
        });
      }
      // A Command with no job answers through the game's own route, which calls aiur's Decision API.
      if (url.includes('/commands/')) {
        return new Response(JSON.stringify(answerStatus === 200 ? { status: 'answered' } : { error: 'no' }), {
          status: answerStatus,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('CommandsInbox', () => {
  it('shows nothing when the game has no open Commands', async () => {
    commands = [];
    renderInbox();

    await waitFor(() => expect(calls.some((call) => call.url.endsWith('/commands'))).toBe(true));
    expect(screen.queryByRole('list', { name: 'Requests' })).not.toBeInTheDocument();
  });

  it('lists the open Commands with rich options and answers through the job checkpoint route', async () => {
    renderInbox();

    const option = await screen.findByRole('button', { name: 'Stone arch' });
    expect(screen.getByText('Which gate should the courtyard use?')).toBeVisible();
    expect(screen.getByText("Builder's pick")).toBeVisible();
    expect(document.querySelector('video')).toHaveAttribute('src', 'https://media.example.test/arch.mp4');

    fireEvent.click(option);

    await waitFor(() =>
      expect(calls).toContainEqual({
        url: '/api/v1/jobs/j_1/checkpoints/m_3/answer',
        method: 'POST',
        body: { option_id: 'stone' },
      }),
    );
  });

  it('opens the job conversation for a Command', async () => {
    const { onOpenJob } = renderInbox();

    fireEvent.click(await screen.findByRole('button', { name: 'Open Build the moon gate' }));

    expect(onOpenJob).toHaveBeenCalledWith('j_1');
  });

  it('answers a Command with no job through the game route and offers no conversation', async () => {
    commands = [commandFixture({ job_id: null, checkpoint_id: 'd_1', decision_id: 'd_1' })];
    renderInbox();

    fireEvent.click(await screen.findByRole('button', { name: 'Stone arch' }));

    await waitFor(() =>
      expect(calls).toContainEqual({
        url: '/api/v1/games/g_1/commands/d_1/answer',
        method: 'POST',
        body: { option_id: 'stone', version: 3 },
      }),
    );
    expect(screen.queryByRole('button', { name: 'Open Build the moon gate' })).not.toBeInTheDocument();
  });

  // A Command whose every option is a sample is a review: the inbox shows it as a row that opens its deck on the review
  // screen (the short link when the game has a slug and the Command a number), not a deck squeezed into the spotlight.
  it('shows a review Command as a row linking to its deck', async () => {
    const image = { url: 'https://media.example.test/a.png', width: 320, height: 320 };
    const review = commandFixture({
      title: 'Pick the gate',
      review_number: 4,
      options: [
        { id: 'a', label: 'Arch', media: image },
        { id: 'b', label: 'Door', media: image },
      ],
    });
    commands = [review];
    const view = renderInbox(vi.fn(), 'moon');

    const row = await screen.findByRole('link', { name: 'Pick the gate, open' });
    expect(row).toHaveAttribute('href', '/moon/review/4');
    expect(screen.queryByRole('region', { name: /^Review / })).not.toBeInTheDocument();
    view.unmount();

    // Without a slug the row falls back to the legacy link, which heals itself to the short form.
    renderInbox();
    expect(await screen.findByRole('link', { name: 'Pick the gate, open' })).toHaveAttribute(
      'href',
      '/game/g_1/review/m_3',
    );
  });

  // A Command with media on only some options keeps the plain list (#611). An aiur clip may carry no duration and no
  // poster; it is still a clip, never an image tag pointing at an mp4.
  it('shows an aiur clip in the option list as a clip', async () => {
    const command = commandFixture({ job_id: null, checkpoint_id: 'd_1', decision_id: 'd_1' });
    command.options = [
      {
        id: 'roll',
        label: 'Roll across the floor',
        media: { url: 'https://api.example.test/blobs/sha256/roll', width: 64, height: 48, kind: 'video' },
      },
      { id: 'flat', label: 'Lie flat' },
    ];
    commands = [command];
    renderInbox();

    const option = await screen.findByRole('button', { name: 'Roll across the floor' });
    expect(option.querySelector('video')).toHaveAttribute('src', 'https://api.example.test/blobs/sha256/roll');
    expect(option.querySelector('img')).toBeNull();
  });

  it('leaves the Command in place when the answer is refused', async () => {
    answerStatus = 409;
    renderInbox();

    fireEvent.click(await screen.findByRole('button', { name: 'Wooden door' }));

    await waitFor(() => expect(calls.some((call) => call.url.endsWith('/checkpoints/m_3/answer'))).toBe(true));
    expect(await screen.findByRole('button', { name: 'Wooden door' })).toBeEnabled();
  });
});
