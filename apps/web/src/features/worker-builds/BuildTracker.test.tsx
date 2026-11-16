import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BuildPanel, BuildTracker } from './BuildTracker';
import type { Job } from '@ogm/contracts';
import { openConversation } from '../build-chat/conversation';

vi.mock('../build-chat/conversation', () => ({ openConversation: vi.fn() }));

vi.mock('./ReviewInbox', () => ({
  ReviewInbox: ({ reviews, commands }: { reviews: unknown[]; commands: unknown[] }) => (
    <div>
      Review deck: {reviews.length} reviews, {commands.length} commands
    </div>
  ),
}));
vi.mock('./TicketConversation', () => ({
  TicketConversation: ({ ticket }: { ticket: { title: string } }) => <div>Conversation: {ticket.title}</div>,
}));
afterEach(cleanup);

describe('build tracker', () => {
  it('lists tappable live and waiting builds with progress bars', () => {
    render(
      <BuildTracker
        workers={[
          { ticket: '1', title: 'Forest backdrop', percent: 40, etaSeconds: null, phase: 'work' },
          { ticket: '2', title: 'Boss attack', percent: 100, etaSeconds: null, state: 'ci-wait' },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /2 builds running/ }));
    expect(screen.getByText('Forest backdrop')).toBeVisible();
    expect(screen.getByText('40%')).toBeVisible();
    expect(screen.getByText('Waiting for checks')).toBeVisible();
    expect(screen.queryByText('100%')).toBeNull();
    expect(screen.queryByText(/left/)).toBeNull();
    expect(screen.getByRole('progressbar', { name: 'Forest backdrop progress' })).toHaveAttribute(
      'aria-valuenow',
      '40',
    );
    expect(screen.getByRole('progressbar', { name: 'Boss attack progress' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Forest backdrop/ }));
    expect(screen.getByRole('dialog', { name: 'Forest backdrop' })).toBeVisible();
    const rows = within(screen.getByRole('region', { name: 'Builds' })).getAllByRole('listitem');
    for (const file of readdirSync('src/features/worker-builds').filter(
      (name) => /\.tsx?$/.test(name) && !name.includes('.test.'),
    )) {
      expect(readFileSync(join('src/features/worker-builds', file), 'utf8')).not.toMatch(
        /\b(?:demo|fixture)[a-z0-9_]*/i,
      );
    }
    expect(rows.map((row) => row.querySelector('strong')?.textContent).filter(Boolean)).toEqual([
      'Forest backdrop',
      'Boss attack',
    ]);
  });
  it('updates an open progress detail when the worker changes', () => {
    const worker = { ticket: 'g:1', title: 'Forest', percent: 40, etaSeconds: null };
    const view = render(<BuildPanel id="builds" workers={[worker]} />);
    fireEvent.click(screen.getByRole('button', { name: /Forest/ }));
    expect(within(screen.getByRole('dialog', { name: 'Forest' })).getByText('40%')).toBeVisible();
    view.rerender(<BuildPanel id="builds" workers={[{ ...worker, percent: 80 }]} />);
    expect(within(screen.getByRole('dialog', { name: 'Forest' })).getByText('80%')).toBeVisible();
  });
  it('opens live progress before offering the matching conversation', () => {
    const worker = { ticket: 'g:1', title: 'Forest', percent: 40, etaSeconds: null };
    const job = { id: 'job', gameId: 'g', aiurIssueNumber: 1 } as Job;
    const view = render(<BuildPanel id="builds" workers={[worker]} jobs={[job]} />);
    fireEvent.click(screen.getByRole('button', { name: /Forest/ }));
    const dialog = screen.getByRole('dialog', { name: 'Forest' });
    expect(within(dialog).getByText('40%')).toBeVisible();
    expect(openConversation).not.toHaveBeenCalled();
    view.rerender(<BuildPanel id="builds" workers={[]} jobs={[job]} workerError />);
    expect(
      within(screen.getByRole('dialog', { name: 'Forest' })).getByText('Could not load build updates'),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Conversation' }));
    expect(openConversation).toHaveBeenCalledWith('job');
  });
  it('groups a build’s reviews together and opens the selected build', () => {
    const reviews = [
      { kind: 'round' as const, gameId: 'g', round: { id: 'a', ticket: '3', question: 'First', media: [] } },
      { kind: 'round' as const, gameId: 'g', round: { id: 'b', ticket: '3', question: 'Second', media: [] } },
      { kind: 'round' as const, gameId: 'g', round: { id: 'c', ticket: '4', question: 'Other', media: [] } },
    ];
    const view = render(
      <BuildPanel
        id="builds"
        workers={[{ ticket: 'g:3', title: 'Forest', state: 'human-review', percent: null, etaSeconds: null }]}
        reviews={reviews}
      />,
    );
    const group = screen.getByRole('button', { name: 'Needs review · 2' });
    expect(group).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /Forest/ })).toBeNull();
    fireEvent.click(group);
    expect(group).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('progressbar', { name: 'Forest progress' })).toHaveTextContent('Needs review');
    fireEvent.click(screen.getByRole('button', { name: /Forest/ }));
    expect(screen.getByText('Review deck: 2 reviews, 0 commands')).toBeVisible();
    view.rerender(<BuildPanel id="builds" workers={[]} reviews={reviews.slice(1)} />);
    expect(screen.getByText('Review deck: 1 reviews, 0 commands')).toBeVisible();
  });
  it('groups a review-stage worker even before a review item is available', () => {
    render(
      <BuildPanel
        id="builds"
        workers={[{ ticket: 'g:5', title: 'Castle', state: 'human-review', percent: null, etaSeconds: null }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Needs review · 1' }));
    fireEvent.click(screen.getByRole('button', { name: /Castle/ }));
    expect(screen.getByRole('dialog', { name: 'Castle' })).toBeVisible();
  });
  it('opens the review deck and the completed list', () => {
    const past = [
      {
        gameId: 'g',
        ticket: '2',
        title: 'Newer',
        outcome: 'Completed',
        closedAt: '2026-02-01',
        url: 'https://github.com/owner/game/issues/2',
      },
      {
        gameId: 'g',
        ticket: '1',
        title: 'Older',
        outcome: 'Cancelled',
        closedAt: '2026-01-01',
        url: 'https://github.com/owner/game/issues/1',
      },
    ];
    const reviews = [
      { kind: 'round' as const, gameId: 'g', round: { id: 'r', ticket: '3', question: null, media: [] } },
    ];
    render(<BuildPanel id="builds" workers={[]} past={past} reviews={reviews} />);
    fireEvent.click(screen.getByRole('button', { name: 'Needs review · 1' }));
    fireEvent.click(screen.getByRole('button', { name: /Build #3/ }));
    expect(screen.getByText('Review deck: 1 reviews, 0 commands')).toBeVisible();
    cleanup();
    render(<BuildPanel id="builds" workers={[]} past={past} />);
    fireEvent.click(screen.getByRole('button', { name: 'Completed' }));
    const dialog = screen.getByRole('dialog', { name: 'Completed' });
    expect(
      within(dialog)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Newer · Completed', 'Older · Cancelled']);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Newer · Completed' }));
    expect(screen.getByText('Conversation: Newer')).toBeVisible();
  });
});
