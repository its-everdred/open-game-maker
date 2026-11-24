import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Job } from '@ogm/contracts';
import { BuildPanel, BuildTracker } from './BuildTracker';
import { useNotificationFeed } from '../../lib/notify/feed';

vi.mock('./MissingMedia', () => ({ MissingMedia: ({ path }: { path: string }) => <span>{path}</span> }));
vi.mock('./ReviewInbox', () => ({
  ReviewInbox: ({ onClose, targets = [] }: { onClose(): void; targets?: unknown[] }) => (
    <div data-testid="review-deck" data-target-count={targets.length}>
      Review deck
      <button type="button" onClick={onClose}>
        Close deck
      </button>
    </div>
  ),
}));
vi.mock('./TicketDetail', () => ({
  TicketDetail: ({
    title,
    ticket,
    gameId,
    onConversation,
  }: {
    title: string;
    ticket: string;
    gameId: string;
    onConversation?(): void;
  }) => (
    <div>
      Detail: {title} {gameId}/{ticket}
      {onConversation && (
        <button type="button" onClick={onConversation}>
          Conversation
        </button>
      )}
    </div>
  ),
}));
const openConversation = vi.hoisted(() => vi.fn());
vi.mock('../build-chat/conversation', () => ({ openConversation }));
vi.mock('./TicketConversation', () => ({
  TicketConversation: ({ ticket }: { ticket: { title: string } }) => <div>Conversation: {ticket.title}</div>,
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('build tracker', () => {
  it('dismisses the popover with its close button or a pointer outside', () => {
    render(
      <>
        <button type="button">Outside</button>
        <BuildTracker workers={[{ ticket: 'g:1', title: 'Running', percent: 20, etaSeconds: null }]} />
      </>,
    );
    const hammer = screen.getByRole('button', { name: '1 build running' });
    fireEvent.click(hammer);
    fireEvent.pointerDown(screen.getByText('Running'));
    expect(screen.getByRole('region', { name: 'Builds' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Close builds' }));
    expect(screen.queryByRole('region', { name: 'Builds' })).toBeNull();
    fireEvent.click(hammer);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('region', { name: 'Builds' })).toBeNull();
  });
  it('counts an update without placing its text over a running game', () => {
    class TestSource extends EventTarget {
      static instances: TestSource[] = [];
      constructor() {
        super();
        TestSource.instances.push(this);
      }
      close() {}
    }
    vi.stubGlobal('EventSource', TestSource);
    function GameWithFeed() {
      useNotificationFeed();
      return (
        <>
          <iframe title="Game" />
          <BuildTracker workers={[{ ticket: '1', title: 'Running', percent: 20, etaSeconds: null }]} />
        </>
      );
    }
    render(<GameWithFeed />);
    expect(document.querySelector('.worker-tracker-count')).toHaveTextContent('1');
    act(() =>
      TestSource.instances[0]!.dispatchEvent(
        new MessageEvent('build.done', { data: JSON.stringify({ title: 'Build complete', body: 'New world' }) }),
      ),
    );
    expect(document.querySelector('.worker-tracker-count')).toHaveTextContent('2');
    expect(screen.queryByText('Build complete — New world')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '1 build running, 1 new update' }));
    expect(screen.getByText('Build complete — New world')).toBeVisible();
  });
  it('shows a completed title after the badge is acknowledged', () => {
    const finished = [{ ticket: 'g:1', title: 'New world' }];
    const view = render(<BuildTracker workers={[]} finished={finished} />);
    expect(screen.queryByText('New world is ready')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Completed builds' }));
    view.rerender(<BuildTracker workers={[]} finished={[]} />);
    expect(screen.getByText('New world is ready')).toBeVisible();
  });
  it('opens the popover and filters reviews before opening one', () => {
    const reviews = [
      { kind: 'round' as const, gameId: 'g', round: { id: 'r', ticket: '3', question: 'Review forest', media: [] } },
    ];
    render(
      <BuildTracker workers={[{ ticket: 'g:1', title: 'Running', percent: 20, etaSeconds: null }]} reviews={reviews} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '1 build running' }));
    expect(screen.queryByText('Review deck')).toBeNull();
    expect(screen.getByText('Running')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '1 need review' }));
    expect(screen.getByText('Running')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Review forest/ }));
    expect(screen.getByText('Review deck')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Close deck' }));
    fireEvent.click(screen.getByRole('button', { name: '1 need review' }));
    expect(screen.getByText('Running')).toBeVisible();
  });
  it('keeps missing-review recovery in expanded rows, outside the review filter', () => {
    render(
      <BuildPanel
        id="builds"
        workers={[{ ticket: 'g:12', title: 'Waiting', percent: null, etaSeconds: null, state: 'human-review' }]}
        coreTargets={[{ source: 'core', ticket: '9', title: 'Core waiting' }]}
        reviewLoading
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '2 need review' }));
    fireEvent.click(screen.getByRole('button', { name: /Waiting/ }));
    expect(screen.getByText('Review deck')).toBeVisible();
  });
  it('removes the selected missing target when its review arrives', () => {
    const workers = [{ ticket: 'g:12', title: 'Waiting', percent: null, etaSeconds: null, state: 'human-review' }];
    const view = render(<BuildPanel id="builds" workers={workers} />);
    fireEvent.click(screen.getByRole('button', { name: '1 need review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Waiting, Needs review, progress unavailable' }));
    expect(screen.getByTestId('review-deck')).toHaveAttribute('data-target-count', '1');
    view.rerender(
      <BuildPanel
        id="builds"
        workers={workers}
        reviews={[{ kind: 'round', gameId: 'g', round: { id: 'r', ticket: '12', question: 'Ready', media: [] } }]}
      />,
    );
    expect(screen.getByTestId('review-deck')).toHaveAttribute('data-target-count', '0');
  });
  it('allows a loaded review to open while other feeds are loading', () => {
    const reviews = [
      { kind: 'round' as const, gameId: 'g', round: { id: 'r', ticket: '3', question: 'Available', media: [] } },
    ];
    render(<BuildPanel id="builds" workers={[]} reviews={reviews} reviewLoading />);
    fireEvent.click(screen.getByRole('button', { name: '1 need review' }));
    fireEvent.click(screen.getByRole('button', { name: /Available/ }));
    expect(screen.getByText('Review deck')).toBeVisible();
  });
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
    fireEvent.click(screen.getByRole('button', { name: '1 need review' }));
    fireEvent.click(screen.getByRole('button', { name: /Build #3/ }));
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
    expect(screen.getByText('Detail: Newer g/2')).toBeVisible();
  });
  // From a detail, Conversation goes to the job's build chat when a job filed the ticket, else to the ticket's own
  // creator-visible discussion: an Executor-filed running ticket has no job but must still open a chat (#1110).
  it('hands a detail over to the right conversation', () => {
    const past = {
      gameId: 'g',
      ticket: '7',
      title: 'Closed',
      outcome: 'Completed',
      closedAt: '2026-02-01',
      url: 'https://github.com/owner/game/issues/7',
    };
    const job = { id: 'j_1', gameId: 'g', aiurIssueNumber: 7 } as unknown as Job;
    const openPast = () => {
      fireEvent.click(screen.getByRole('button', { name: 'Completed' }));
      fireEvent.click(screen.getByRole('button', { name: 'Closed · Completed' }));
      fireEvent.click(screen.getByRole('button', { name: 'Conversation' }));
    };
    render(<BuildPanel id="builds" workers={[]} past={[past]} jobs={[job]} />);
    openPast();
    expect(openConversation).toHaveBeenCalledWith('j_1');
    cleanup();
    render(<BuildPanel id="builds" workers={[]} past={[past]} />);
    openPast();
    expect(screen.getByText('Conversation: Closed')).toBeVisible();
    cleanup();
    render(<BuildPanel id="builds" workers={[{ ticket: 'g:12', title: 'Running', percent: 5, etaSeconds: null }]} />);
    fireEvent.click(screen.getByRole('button', { name: /Running/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByText('Detail: Running g/12')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Conversation' }));
    expect(screen.getByText('Conversation: Running')).toBeVisible();
  });

  it('opens progress for a worker without a game identifier', () => {
    render(<BuildPanel id="builds" workers={[{ ticket: '12', title: 'Orphan', percent: 5, etaSeconds: null }]} />);
    fireEvent.click(screen.getByRole('button', { name: /Orphan/ }));
    expect(screen.getByText('5% complete')).toBeVisible();
  });

  // A running build opens the same detail as a finished one (#873); its row carries the game it belongs to.
  it('opens a running build’s detail from its row', () => {
    render(
      <BuildPanel
        id="builds"
        workers={[{ ticket: 'g_1:12', title: 'Forest backdrop', percent: 40, etaSeconds: null }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Forest backdrop/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByText('Detail: Forest backdrop g_1/12')).toBeVisible();
  });
});
