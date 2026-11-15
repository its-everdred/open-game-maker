import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BuildPanel, BuildTracker } from './BuildTracker';

vi.mock('./ReviewInbox', () => ({ ReviewInbox: () => <div>Review deck</div> }));
vi.mock('./TicketConversation', () => ({
  TicketConversation: ({ ticket }: { ticket: { title: string } }) => <div>Conversation: {ticket.title}</div>,
}));
afterEach(cleanup);

describe('build tracker', () => {
  it('lists live progress without guessing an ETA and shows waiting states instead of a full bar', () => {
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
    fireEvent.click(screen.getByRole('button', { name: '1 Needs Review' }));
    expect(screen.getByText('Review deck')).toBeVisible();
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
