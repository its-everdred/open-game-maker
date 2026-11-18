import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TicketDetail, type TicketDetailView } from './TicketDetail';

const api = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api/client', () => ({ api }));
afterEach(() => {
  cleanup();
  api.mockReset();
});

const view: TicketDetailView = {
  ticket: '644',
  title: 'Trailer round 2',
  status: 'waiting_on_creator',
  phase: 'playtesting_and_verification',
  running: true,
  activity: 'Capturing the 16:9 cut',
  summary: 'Round 2 trailer is merged and waits on your verdict.',
  issueUrl: 'https://github.com/owner/blobs/issues/644',
  pr: { number: 666, url: 'https://github.com/owner/blobs/pull/666', state: 'merged', ci: 'passed' },
  media: [
    { id: 'a', kind: 'image', url: '/blobs/sha256/a?sig=1', caption: 'Title card' },
    { id: 'b', kind: 'video', url: '/blobs/sha256/b?sig=1', caption: '23 s cut' },
    { id: 'c', kind: 'audio', url: '/blobs/sha256/c?sig=1', caption: null },
  ],
  timeline: [
    { at: '2026-11-17T09:00:00Z', kind: 'round_started', label: null, quote: null },
    { at: '2026-11-17T10:00:00Z', kind: 'creator_verdict', label: 'Needs changes', quote: 'trailers should loop' },
  ],
};

function show(onConversation?: () => void) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <TicketDetail
          gameId="g 1"
          ticket="644"
          title="Listed title"
          onClose={() => {}}
          onConversation={onConversation}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return screen.getByRole('dialog');
}

describe('ticket detail', () => {
  // Kevin taps a ticket and sees what it is, where it stands, the worker's media and his own verdict (#873).
  it('shows the summary, status, PR, every media kind and the verdict quote', async () => {
    api.mockResolvedValue(view);
    const onConversation = vi.fn();
    const dialog = show(onConversation);
    expect(await within(dialog).findByText(view.summary!)).toBeVisible();
    expect(api).toHaveBeenCalledWith('/games/g%201/tickets/644/detail');
    expect(within(dialog).getByRole('heading', { name: 'Trailer round 2' })).toBeVisible();
    for (const chip of ['Needs review', 'Playtesting and verification', '#666 Merged', 'Checks passed'])
      expect(within(dialog).getByText(chip)).toBeVisible();
    expect(within(dialog).getByText('Capturing the 16:9 cut')).toBeVisible();
    expect(within(dialog).getByRole('img', { name: 'Title card' })).toHaveAttribute('src', view.media[0]!.url);
    expect(dialog.querySelector('video')).toHaveAttribute('src', view.media[1]!.url);
    expect(dialog.querySelector('audio')).toHaveAttribute('src', view.media[2]!.url);
    // Newest first, with the creator's words quoted.
    const entries = within(dialog)
      .getAllByRole('listitem')
      .filter((item) => item.querySelector('time'));
    expect(entries.map((item) => item.querySelector('span')?.textContent)).toEqual(['Needs changes', 'Round started']);
    expect(within(dialog).getByText('trailers should loop').tagName).toBe('BLOCKQUOTE');
    expect(within(dialog).getByRole('link', { name: 'Ticket' })).toHaveAttribute('href', view.issueUrl);
    expect(within(dialog).getByRole('link', { name: 'Open game' })).toHaveAttribute('href', '/g/g%201');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Conversation' }));
    expect(onConversation).toHaveBeenCalled();
  });

  it('keeps the listed title and says so when the detail cannot load', async () => {
    api.mockRejectedValue(new Error('api 503'));
    const dialog = show();
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Could not load this ticket.');
    expect(within(dialog).getByRole('heading', { name: 'Listed title' })).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: 'Conversation' })).toBeNull();
  });
});
