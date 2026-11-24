import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';

import { GameMenuProvider } from './GameMenu';
import { StudioMenu } from './StudioMenu';
import { setUpdateOwner } from '../lib/notify/slice';

const games = [
  { id: 'g_helm', title: 'Dusk Helm', ownerId: 'u_kevin' },
  { id: 'g_blobs', title: 'Blobs', ownerId: 'u_kevin' },
];
const workerState = vi.hoisted(() => ({ error: false }));
const command = (game_id: string, title: string) => ({
  game_id,
  game_title: game_id,
  title,
  decision_id: `d_${game_id}`,
  ticket: '7',
  options: [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
  ],
});

vi.mock('../features/build-chat/jobs', () => ({
  isTerminal: () => false,
  useMyJobs: () => ({ jobs: [], active: [], games }),
  setJobPaused: vi.fn(),
}));
// Each game's daemon answers for its own game only, as the real hooks do per game.
vi.mock('../features/worker-builds/useWorkers', () => ({
  useWorkers: (tracked: { id: string }[]) => ({
    workers: tracked.map(({ id }) => ({
      ticket: `${id}:1`,
      title: `${id} build`,
      percent: 40,
      etaSeconds: null,
      state: 'in-progress',
    })),
    feeds: [],
    error: workerState.error,
    loading: false,
  }),
}));
vi.mock('../features/worker-builds/useWorkerReviews', () => ({
  useWorkerReviews: () => ({ reviews: [], error: false, loading: false }),
}));
vi.mock('../features/worker-builds/usePastTickets', () => ({
  usePastTickets: () => ({ tickets: [], error: false, loading: false }),
}));
vi.mock('../features/commands-inbox/commands', () => ({
  useCoreReviewCommands: () => ({
    commands: [],
    targets: [{ source: 'core', ticket: '900', title: 'Review the published blobs build' }],
    error: false,
    loading: false,
  }),
  useCreatorReviewCommands: () => ({
    commands: [command('g_helm', 'Helm sky'), command('g_blobs', 'Blobs colours')],
    error: false,
    loading: false,
  }),
  useCreatorCommands: () => ({ commands: [], sessions: [] }),
}));
vi.mock('../lib/api/session', () => ({ useSession: () => ({ data: { user: { id: 'u_kevin' } } }) }));
vi.mock('../routes/admin/api', () => ({ useAdminMe: () => ({ data: undefined }) }));
vi.mock('../features/executor-thread/thread', () => ({
  closeThread: vi.fn(),
  openThread: vi.fn(),
  useThreadAccess: () => false,
  useThreadPolling: vi.fn(),
  useUnreadReplies: () => 0,
}));
vi.mock('../lib/sound', () => ({
  getVolume: () => 0.75,
  onChange: () => () => undefined,
  setMuted: vi.fn(),
  setVolume: vi.fn(),
  status: () => 'on',
}));

afterEach(() => {
  cleanup();
  setUpdateOwner(undefined);
  workerState.error = false;
});

function openBuilds(path: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <GameMenuProvider>
          <StudioMenu />
        </GameMenuProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  /* The library's hammer sits in its header; a game's is a circle in the menu. */
  const menu = screen.queryByRole('button', { name: 'Menu' });
  if (menu) fireEvent.click(menu);
  const hammer = screen.getByRole('button', { name: /builds? running/ });
  const label = hammer.getAttribute('aria-label');
  const badge = hammer.textContent;
  fireEvent.click(hammer);
  return { hammer, label, badge, panel: screen.getByRole('region', { name: 'Builds' }) };
}

function openEditor(path: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <GameMenuProvider>
          <StudioMenu />
        </GameMenuProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const menu = screen.getByRole('button', { name: 'Menu' });
  const badge = menu.querySelector('.studio-menu-badge')?.textContent;
  fireEvent.click(menu);
  return { badge, dialog: screen.getByRole('dialog', { name: 'Paused' }) };
}

// Kevin (#1296): in Dusk Helm's editor the Builds panel listed Blobs, goblin-cellar and core review tickets, with a
// count and a hammer badge for every game. In a game the menu (#1326) shows that game's reviews and work only, and its
// badge counts only what is ready for review.
it("shows only the edited game's work, reviews and badge in its editor", () => {
  const { badge, dialog } = openEditor('/g/g_helm?mode=edit');
  const review = within(dialog).getByRole('region', { name: 'Review' });
  expect(within(review).getByText('Helm sky')).toBeTruthy();
  expect(within(review).queryByText('Blobs colours')).toBeNull();
  expect(within(review).queryByText('Review the published blobs build')).toBeNull();
  const work = within(dialog).getByRole('region', { name: 'Work' });
  expect(within(work).getByText('g_helm build')).toBeTruthy();
  expect(within(work).queryByText('g_blobs build')).toBeNull();
  expect(badge).toBe('1');
});

it('keeps every game and the core in the app-wide view', () => {
  const { panel } = openBuilds('/all');
  expect(within(panel).getByText('g_blobs build')).toBeTruthy();
  fireEvent.click(within(panel).getByRole('button', { name: '3 need review' }));
  expect(within(panel).getByText('Review the published blobs build')).toBeTruthy();
});

// A source that failed (a daemon or tracker read) leaves the creator what did load, with no failure wording.
it('keeps what loaded in the editor menu when a source failed', () => {
  workerState.error = true;
  const { dialog } = openEditor('/g/g_helm?mode=edit');
  expect(within(within(dialog).getByRole('region', { name: 'Work' })).getByText('g_helm build')).toBeTruthy();
  expect(within(within(dialog).getByRole('region', { name: 'Review' })).getByText('Helm sky')).toBeTruthy();
  expect(dialog.textContent).not.toMatch(/fail|error|unavailable/i);
});
