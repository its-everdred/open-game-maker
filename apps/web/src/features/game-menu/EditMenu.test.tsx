import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WorkerReview } from '../worker-builds/useWorkerReviews';
import { EditMenu } from './EditMenu';
import type { ReviewCard, WorkRow } from './model';

const openConversation = vi.hoisted(() => vi.fn());
vi.mock('../build-chat/conversation', () => ({ openConversation }));
vi.mock('../energy/api', () => ({
  WINDOW_LABELS: { day: 'Today', week: 'This week', month: 'This month' },
  useEnergy: () => ({
    data: {
      level: 'healthy',
      preference: 'balanced',
      windows: [],
      services: [],
      sources: [
        {
          id: 'claude',
          label: 'Claude',
          usedPercent: 62,
          resetsAt: null,
          basis: 'reported',
          observedAt: null,
          stale: false,
        },
      ],
    },
  }),
}));
vi.mock('../worker-builds/ReviewInbox', () => ({
  ReviewInbox: ({ initialReview, onClose }: { initialReview?: WorkerReview; onClose(): void }) => (
    <div role="dialog" aria-label="Review inbox">
      {initialReview?.kind === 'round' ? initialReview.round.id : 'none'}
      <button type="button" onClick={onClose}>
        Close inbox
      </button>
    </div>
  ),
}));
vi.mock('../worker-builds/TicketDetail', () => ({
  TicketDetail: ({ ticket }: { ticket: string }) => <div role="dialog" aria-label={`Ticket ${ticket}`} />,
}));

afterEach(() => {
  cleanup();
  openConversation.mockClear();
});

const review: WorkerReview = {
  kind: 'round',
  gameId: 'g1',
  round: { id: 'round-16', ticket: '16', question: 'Orbs?', media: [] },
};
const card: ReviewCard = { key: 'g1:round:round-16', title: 'UI kit', sub: '#16', review };
const rows: WorkRow[] = [
  { key: 'g1:969', ticket: '969', title: 'Dusk and torch', percent: 80, state: 'wait', last: 'Warmer?', gameId: 'g1' },
  { key: 'g1:41', ticket: '41', title: 'Forest road', percent: 55, state: 'work', jobId: 'job-41', gameId: 'g1' },
];

function renderMenu(props: Partial<Parameters<typeof EditMenu>[0]> = {}) {
  const onClose = vi.fn();
  const ask = vi.fn();
  render(
    <MemoryRouter>
      <EditMenu
        open
        onClose={onClose}
        cards={[card]}
        sessions={[]}
        rows={rows}
        inbox={{ workers: [], reviews: [review], commands: [], targets: [], error: false, incomplete: false }}
        gamePath="/g/g1"
        admin={false}
        signedIn
        signingOut={false}
        actions={[{ id: 'ask-change', label: 'Ask for a change', icon: 'speak', onSelect: ask }]}
        extras={[]}
        onQuestions={vi.fn()}
        onSignOut={vi.fn()}
        {...props}
      />
    </MemoryRouter>,
  );
  return { onClose, ask };
}

describe('edit menu (#1326)', () => {
  it('lists ready reviews before the work, then Energy and More, in a paused modal', () => {
    renderMenu();
    const dialog = screen.getByRole('dialog', { name: 'Paused' });
    const order = within(dialog)
      .getAllByRole('region')
      .map((region) => region.getAttribute('aria-label'));
    expect(order).toEqual(['Review', 'Work', 'Energy']);
    expect(within(dialog).getByRole('button', { name: 'More' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens the in-app review for a card', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: /UI kit/ }));
    expect(screen.getByRole('dialog', { name: 'Review inbox' })).toHaveTextContent('round-16');
  });

  it("opens the agent's chat for a job-owned row, else the ticket", () => {
    renderMenu();
    const work = screen.getByRole('region', { name: 'Work' });
    fireEvent.click(within(work).getByRole('button', { name: /Forest road/ }));
    expect(openConversation).toHaveBeenCalledWith('job-41');
    fireEvent.click(within(work).getByRole('button', { name: /Dusk and torch/ }));
    expect(screen.getByRole('dialog', { name: 'Ticket 969' })).toBeInTheDocument();
  });

  it('shows each row with its number, progress, state and last line', () => {
    renderMenu();
    const row = within(screen.getByRole('region', { name: 'Work' })).getByRole('button', { name: /Dusk and torch/ });
    expect(row).toHaveTextContent('#969');
    expect(row).toHaveTextContent('80%');
    expect(row).toHaveTextContent('Waiting on you');
    expect(row).toHaveTextContent('Warmer?');
    expect(within(row).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '80');
  });

  it('offers Ask for a change when nothing is in progress', () => {
    const { onClose, ask } = renderMenu({ cards: [], rows: [] });
    expect(screen.getByText('Nothing in progress')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ask for a change' }));
    expect(onClose).toHaveBeenCalled();
    expect(ask).toHaveBeenCalled();
  });

  it('keeps Publish, Versions and Sign out behind More', () => {
    renderMenu();
    expect(screen.queryByRole('link', { name: 'Publish' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('link', { name: 'Publish' })).toHaveAttribute('href', '/g/g1/releases?action=publish');
    expect(screen.getByRole('link', { name: 'Versions' })).toHaveAttribute('href', '/g/g1/versions');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('resumes from the header and stays mounted while closed', () => {
    const { onClose } = renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(onClose).toHaveBeenCalled();
    cleanup();
    renderMenu({ open: false });
    expect(screen.queryByRole('dialog', { name: 'Paused' })).toBeNull();
    expect(document.getElementById('studio-editor-tools')).not.toBeNull();
  });
});
