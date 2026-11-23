import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';

import { GameMenuProvider } from './GameMenu';
import { StudioMenu } from './StudioMenu';
import { pushUpdate, setUpdateOwner } from '../lib/notify/slice';

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

// Kevin (#1296): in Dusk Helm's editor the Builds panel listed Blobs, goblin-cellar and core review tickets, with a
// count and a hammer badge for every game. In a game it shows that game's work only.
it("shows only the edited game's builds, reviews and badge in its editor", () => {
  const { hammer, panel } = openBuilds('/g/g_helm?mode=edit');
  expect(within(panel).getByText('g_helm build')).toBeTruthy();
  expect(within(panel).queryByText('g_blobs build')).toBeNull();
  fireEvent.click(within(panel).getByRole('button', { name: '1 need review' }));
  expect(within(panel).getByText('Helm sky')).toBeTruthy();
  expect(within(panel).queryByText('Blobs colours')).toBeNull();
  expect(within(panel).queryByText('Review the published blobs build')).toBeNull();
  // One review waiting plus one running build.
  expect(within(hammer).getByText('2')).toBeTruthy();
});

it('keeps every game and the core in the app-wide view', () => {
  const { panel } = openBuilds('/all');
  expect(within(panel).getByText('g_blobs build')).toBeTruthy();
  fireEvent.click(within(panel).getByRole('button', { name: '3 need review' }));
  expect(within(panel).getByText('Review the published blobs build')).toBeTruthy();
});

it("counts only the edited game's updates, and never shows the creator a failed source", () => {
  setUpdateOwner('u_kevin');
  pushUpdate('Your build is ready — Blobs', 'g_blobs');
  pushUpdate('Your build is ready — Dusk Helm', 'g_helm');
  workerState.error = true;
  const { label, badge, panel } = openBuilds('/g/g_helm?mode=edit');
  expect(within(panel).getByText('Your build is ready — Dusk Helm')).toBeTruthy();
  expect(within(panel).queryByText('Your build is ready — Blobs')).toBeNull();
  expect(within(panel).queryByRole('alert')).toBeNull();
  // One review, one running build and one unread update about this game.
  expect(label).toBe('1 build running, 1 new update');
  expect(badge).toBe('3');
});
