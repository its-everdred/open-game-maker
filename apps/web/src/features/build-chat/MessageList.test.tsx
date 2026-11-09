import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { queryClient } from '../../app/query';
import { MessageList } from './MessageList';
import type { StreamedChatMessage } from './stream';

const base = {
  job_id: 'j_1',
  at: '2026-11-01T09:00:00Z',
  actor: 'agent' as const,
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ used: 1, max: 3 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('MessageList', () => {
  it('shows the file names of a creator message sent with only attachments', () => {
    render(
      <MessageList
        messages={[
          {
            ...base,
            id: 'm_files',
            actor: 'creator',
            kind: 'text',
            attachments: [
              { id: 'a_1', kind: 'text', name: 'notes.md', mime: 'text/markdown', bytes: 9 },
              { id: 'a_2', kind: 'image', name: 'castle.png', mime: 'image/webp', bytes: 40 },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByText('notes.md')).toBeVisible();
    expect(screen.getByText('castle.png')).toBeVisible();
  });

  it('renders reserved media, progress, and an actionable command', () => {
    const messages: StreamedChatMessage[] = [
      {
        ...base,
        id: 'm_1',
        kind: 'image',
        text: 'The new room',
        media: { url: 'https://example.test/room.webp', width: 640, height: 360 },
      },
      { ...base, id: 'm_2', kind: 'progress', actor: 'system', text: 'Wiring the door' },
      {
        ...base,
        id: 'm_3',
        kind: 'command',
        command: {
          decision_id: 'd_1',
          question: 'Which door?',
          options: [{ id: 'wood', label: 'Wooden', media_id: 'm_1' }],
          recommend: 'wood',
          status: 'open',
        },
      },
    ];

    render(<MessageList messages={messages} />);

    expect(screen.getByRole('img', { name: 'The new room' }).parentElement).toHaveStyle({
      aspectRatio: '640 / 360',
    });
    expect(screen.getByText('Wiring the door')).toBeInTheDocument();
    expect(screen.getByText('Which door?')).toBeInTheDocument();
    expect(screen.getByText('Wooden')).toBeInTheDocument();
    expect(screen.getByText("Builder's pick")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Wooden' })).toBeInTheDocument();
  });

  it('loads the command budget and posts the selected option through the row', async () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/commands/budget')) {
        return new Response(JSON.stringify({ used: 1, max: 3 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ status: 'answered', decision_id: 'd_1', option_id: 'wood' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const messages: StreamedChatMessage[] = [
      {
        ...base,
        id: 'm_3',
        kind: 'command',
        command: {
          decision_id: 'd_1',
          question: 'Which door?',
          options: [
            { id: 'wood', label: 'Wooden' },
            { id: 'iron', label: 'Iron' },
          ],
          status: 'open',
        },
      },
    ];

    render(<MessageList messages={messages} />);
    expect(await screen.findByText('Question 1 of 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Wooden' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/jobs/j_1/commands/m_3/answer',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ option_id: 'wood' }) }),
      );
    });
    expect(screen.getByRole('button', { name: 'Wooden' })).toBeDisabled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['build-chat', 'jobs'] });
  });

  it('falls back to text for an unknown kind', () => {
    render(<MessageList messages={[{ ...base, id: 'm_4', kind: 'future', text: 'Still readable' }]} />);
    expect(screen.getByText('Still readable')).toBeInTheDocument();
  });

  it('keeps a failed media row reserved and captioned', () => {
    render(
      <MessageList
        messages={[
          {
            ...base,
            id: 'm_failed',
            kind: 'image',
            text: 'Door preview',
            media: { url: 'https://example.test/missing.webp', width: 640, height: 360 },
          },
        ]}
      />,
    );

    const image = screen.getByRole('img', { name: 'Door preview' });
    fireEvent.error(image);
    expect(screen.getByRole('img', { name: 'Door preview unavailable' }).parentElement).toHaveStyle({
      aspectRatio: '640 / 360',
    });
    expect(screen.getByText('Door preview')).toBeInTheDocument();
  });

  it('keeps a pinned list at the bottom but leaves a reader who scrolled up alone', () => {
    const first = { ...base, id: 'm_1', kind: 'text', text: 'First' };
    const second = { ...base, id: 'm_2', kind: 'text', text: 'Second' };
    const third = { ...base, id: 'm_3', kind: 'text', text: 'Third' };
    const { rerender } = render(<MessageList messages={[first]} />);
    const list = screen.getByRole('log');
    Object.defineProperties(list, {
      scrollHeight: { configurable: true, value: 500 },
      clientHeight: { configurable: true, value: 100 },
    });

    list.scrollTop = 400;
    fireEvent.scroll(list);
    rerender(<MessageList messages={[first, second]} />);
    expect(list.scrollTop).toBe(500);

    list.scrollTop = 100;
    fireEvent.scroll(list);
    rerender(<MessageList messages={[first, second, third]} />);
    expect(list.scrollTop).toBe(100);
  });
});
