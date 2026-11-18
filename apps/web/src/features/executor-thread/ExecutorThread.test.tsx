import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreatorCommand } from '@ogm/contracts/browser';

import { ExecutorThread } from './ExecutorThread';
import { pull, threadMessages, useThreadStore, useUnreadReplies, type ThreadMessage } from './thread';

// aiur's thread is mocked behind the app's own API (`/api/v1/me/executor/thread/*`) until aiur-team/aiur#8034 ships.
const OWNER = 'u_owner';
const calls: Array<{ url: string; method: string; body: unknown }> = [];
let pages: unknown[] = [];

function reply(pos: number, text: string, attachments: ThreadMessage['attachments'] = []): ThreadMessage {
  return { id: `pos_${pos}`, pos, request_id: null, role: 'executor', text, attachments, delivery: null };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  calls.length = 0;
  pages = [];
  localStorage.clear();
  useThreadStore.setState({
    owner: undefined,
    journal: [],
    queued: [],
    local: [],
    after: 0,
    loaded: false,
    open: true,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body });
      if (method === 'POST' && url.endsWith('/messages'))
        return json(
          {
            message: {
              id: 'req_5',
              pos: null,
              request_id: 5,
              role: 'operator',
              text: 'x',
              attachments: [],
              delivery: 'queued',
            },
          },
          202,
        );
      if (method === 'POST' && url.endsWith('/uploads')) return json({ upload_id: 'up_1' }, 201);
      return json(pages.shift() ?? { messages: [], next_after: 0, queued: [] });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('executor thread', () => {
  it('shows a reply’s pictures, clip and sound inline', async () => {
    pages = [
      {
        messages: [
          reply(3, 'Versus CPU now ends on a results screen.', [
            { id: 'a1', kind: 'image', mime: 'image/png', url: '/api/v1/me/executor/thread/attachments/a1' },
            { id: 'a2', kind: 'video', mime: 'video/mp4', url: '/api/v1/me/executor/thread/attachments/a2' },
            { id: 'a3', kind: 'audio', mime: 'audio/mpeg', url: '/api/v1/me/executor/thread/attachments/a3' },
          ]),
        ],
        next_after: 3,
        queued: [],
      },
    ];
    await pull(OWNER);
    render(<ExecutorThread creatorId={OWNER} title="Blobs" context={{}} commands={[]} onOpenCommand={vi.fn()} />);
    expect(screen.getByText('Versus CPU now ends on a results screen.')).toBeTruthy();
    expect(document.querySelector('img')?.getAttribute('src')).toBe('/api/v1/me/executor/thread/attachments/a1');
    expect(document.querySelector('video')?.getAttribute('src')).toBe('/api/v1/me/executor/thread/attachments/a2');
    expect(document.querySelector('audio')?.getAttribute('src')).toBe('/api/v1/me/executor/thread/attachments/a3');
  });

  // Ask (#854): the game and screen go with every message without the creator typing them.
  it('sends the ask with where the creator is and shows it at once', async () => {
    render(
      <ExecutorThread
        creatorId={OWNER}
        title="Blobs"
        context={{ game_id: 'g_1', screen: '/g/g_1?mode=play' }}
        commands={[]}
        onOpenCommand={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Make Endless the big button' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true));
    const sent = calls.find((call) => call.method === 'POST')!;
    expect(sent.url).toBe('/api/v1/me/executor/thread/messages');
    expect(sent.body).toMatchObject({
      text: 'Make Endless the big button',
      context: { game_id: 'g_1', screen: '/g/g_1?mode=play' },
    });
    expect(screen.getByText('Make Endless the big button')).toBeTruthy();
  });

  it('uploads a screenshot to the thread and sends it as an attachment', async () => {
    render(<ExecutorThread creatorId={OWNER} title="Blobs" context={{}} commands={[]} onOpenCommand={vi.fn()} />);
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, {
      target: { files: [new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' })] },
    });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'This button' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(calls.some((call) => call.url.endsWith('/messages') && call.method === 'POST')).toBe(true),
    );
    expect(calls.find((call) => call.url.endsWith('/uploads'))).toBeTruthy();
    expect(calls.find((call) => call.url.endsWith('/messages') && call.method === 'POST')!.body).toMatchObject({
      attachments: [{ upload_id: 'up_1', kind: 'image', mime_type: 'image/png' }],
    });
  });

  // Review (#843): a Command waiting on the creator sits in the thread and opens the review deck.
  it('opens the review deck from a Command in the thread', () => {
    const command = {
      decision_id: 'd_1',
      title: 'Which menu?',
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
    } as unknown as CreatorCommand;
    const onOpenCommand = vi.fn();
    render(
      <ExecutorThread
        creatorId={OWNER}
        title="Blobs"
        context={{}}
        commands={[command]}
        onOpenCommand={onOpenCommand}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'B' }));
    expect(onOpenCommand).toHaveBeenCalledWith(command);
  });

  it('hides the context note from the creator’s own messages', () => {
    const journal: ThreadMessage[] = [
      {
        id: 'pos_1',
        pos: 1,
        request_id: 5,
        role: 'operator',
        text: 'Make it blue\n\n[Sent from Open Game Maker: game Blobs (blobs), screen /g/g_1]',
        attachments: [],
        delivery: 'delivered',
      },
    ];
    const queued: ThreadMessage[] = [
      { id: 'req_5', request_id: 5, role: 'operator', text: 'Make it blue', attachments: [], delivery: 'queued' },
    ];
    // Delivered once: the queued copy of a message the journal already lists is not shown twice.
    expect(threadMessages({ journal, queued, local: [] })).toHaveLength(1);
    useThreadStore.setState({ journal, queued });
    render(<ExecutorThread creatorId={OWNER} title="Blobs" context={{}} commands={[]} onOpenCommand={vi.fn()} />);
    expect(screen.getByText('Make it blue')).toBeTruthy();
    expect(screen.queryByText(/Sent from Open Game Maker/u)).toBeNull();
  });
});

describe('unread replies', () => {
  // Notify (#878): a reply raises a count only; the history a device first loads is not news.
  it('counts replies after the first load until the thread is opened', async () => {
    useThreadStore.setState({ open: false });
    pages = [{ messages: [reply(1, 'old')], next_after: 1, queued: [] }];
    await pull(OWNER);
    const { result, rerender } = renderHook(() => useUnreadReplies(OWNER));
    expect(result.current).toBe(0);
    pages = [{ messages: [reply(2, 'new')], next_after: 2, queued: [] }];
    await act(() => pull(OWNER));
    rerender();
    expect(result.current).toBe(1);
    act(() => useThreadStore.setState({ open: true }));
    act(() => useThreadStore.setState({ open: false }));
    rerender();
    expect(result.current).toBe(0);
  });
});
