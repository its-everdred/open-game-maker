import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StudioMenu } from './StudioMenu';

const state = vi.hoisted(() => ({
  admin: { data: undefined as { platformRole: 'maintainer' | 'admin' | 'none' } | undefined },
  jobs: { jobs: [] as TestJob[], active: [] as TestJob[], games: [] as Array<{ id: string; title: string }> },
  session: { data: null as { user: { id: string } } | null },
  decisions: [] as TestDecision[],
}));

const sound = vi.hoisted(() => ({
  getVolume: vi.fn(() => 0.75),
  onChange: vi.fn(() => () => undefined),
  setMuted: vi.fn(),
  setVolume: vi.fn(),
  status: vi.fn(() => 'on' as const),
}));
const auth = vi.hoisted(() => ({ signOut: vi.fn() }));

vi.mock('../features/build-chat/jobs', () => ({
  isTerminal: (value: string) => ['done', 'failed', 'cancelled'].includes(value),
  useMyJobs: () => state.jobs,
}));
vi.mock('../features/build-chat/Chat', () => ({
  Chat: ({ jobId }: { jobId?: string }) => <p>conversation {jobId}</p>,
}));
vi.mock('../features/commands-inbox/commands', () => ({
  answerCommand: vi.fn(async () => undefined),
  useCreatorCommands: (creatorId: string | undefined) => ({ commands: creatorId ? state.decisions : [] }),
}));
vi.mock('../lib/api/session', () => ({ useSession: () => state.session }));
vi.mock('../lib/api/auth', () => auth);
vi.mock('../lib/sound', () => sound);
vi.mock('../routes/admin/api', () => ({ useAdminMe: () => state.admin }));

type TestDecision = {
  game_id: string;
  game_title: string;
  decision_id: string;
  checkpoint_id: string;
  job_id: string | null;
  title: string;
  summary?: string;
  question: string;
  blocking: boolean;
  options: Array<{ id: string; label: string }>;
};

const decision = (id: string, overrides: Partial<TestDecision> = {}): TestDecision => ({
  game_id: 'game-blobs',
  game_title: 'Blobs',
  decision_id: id,
  checkpoint_id: id,
  job_id: null,
  title: `Question ${id}`,
  summary: `Topic ${id}`,
  question: `Which ${id}?`,
  blocking: false,
  options: [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
  ],
  ...overrides,
});

type TestJob = {
  id: string;
  gameId: string;
  branchId: string;
  state: 'queued' | 'running' | 'done';
  stage?: 'queued_ogm' | 'building' | 'paused' | 'parked' | 'done';
  stageText?: string;
  progressPercent?: number;
  openRequestCount?: number;
  kind: 'new_game' | 'feature' | 'repair' | 'scope';
  plan: { title: string };
  updatedAt: string;
  terminalAt: string | null;
};

const runningJob = (overrides: Partial<TestJob> = {}): TestJob => ({
  id: 'job-1',
  gameId: 'game-1',
  branchId: 'main',
  state: 'running',
  stage: 'building',
  stageText: 'Building rooms',
  progressPercent: 42,
  openRequestCount: 0,
  kind: 'feature',
  plan: { title: 'Build the moon gate' },
  updatedAt: new Date().toISOString(),
  terminalAt: null,
  ...overrides,
});

afterEach(() => {
  cleanup();
  state.admin = { data: undefined };
  state.jobs = { jobs: [], active: [], games: [] };
  state.session = { data: null };
  state.decisions = [];
  sound.setMuted.mockReset();
  sound.setVolume.mockReset();
  auth.signOut.mockReset();
  vi.useRealTimers();
});

describe('StudioMenu', () => {
  it('opens the always-available controls on the title without signed-in links', () => {
    renderMenu('/');

    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));

    expect(screen.getByRole('slider', { name: 'Volume' })).toHaveValue('0.75');
    expect(screen.getByRole('button', { name: 'Mute' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Report a problem' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Credits' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Versions' })).not.toBeInTheDocument();
  });

  it('shows signed-in and game actions only in their relevant context', () => {
    state.session = { data: { user: { id: 'user-1' } } };
    state.admin = { data: { platformRole: 'maintainer' } };

    const view = renderMenu('/games');
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));

    expect(screen.getByRole('link', { name: 'Credits' })).toHaveAttribute('href', '/settings/credits');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
    expect(screen.queryByRole('link', { name: 'Versions' })).not.toBeInTheDocument();

    view.unmount();
    renderMenu('/g/game-1?mode=edit');
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));

    expect(screen.getByRole('link', { name: 'Versions' })).toHaveAttribute('href', '/g/game-1/versions');
    expect(screen.getByRole('link', { name: 'Publish' })).toHaveAttribute('href', '/g/game-1/releases?action=publish');
    expect(screen.getByRole('link', { name: 'Rollback' })).toHaveAttribute(
      'href',
      '/g/game-1/releases?action=rollback',
    );
  });

  it('moves build progress to the menu and announces each start and end once', () => {
    const job = runningJob();
    state.session = { data: { user: { id: 'user-1' } } };
    state.jobs = { jobs: [job], active: [job], games: [{ id: 'game-1', title: 'Moon Vault' }] };

    const view = renderMenu('/games');
    const trigger = screen.getByRole('button', { name: 'Menu' });
    expect(trigger).toHaveAttribute('data-building', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Building Moon Vault');

    fireEvent.click(trigger);
    expect(screen.getByRole('button', { name: /Build the moon gate.*Active.*Building rooms.*42%/ })).toBeVisible();

    view.unmount();
    const remounted = renderMenu('/games');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();

    const finished = runningJob({
      state: 'done',
      stage: 'done',
      stageText: 'Ready to try',
      progressPercent: 100,
      terminalAt: new Date().toISOString(),
    });
    state.jobs = { jobs: [finished], active: [], games: [{ id: 'game-1', title: 'Moon Vault' }] };
    remounted.rerender(
      <MemoryRouter initialEntries={['/games']}>
        <StudioMenu />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute('data-building', 'false');
    expect(screen.getByRole('status')).toHaveTextContent('Finished building Moon Vault');
  });

  it('removes a just-finished build when its recent window expires', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-03T18:00:00.000Z'));
    const finished = runningJob({
      state: 'done',
      stage: 'done',
      stageText: 'Ready to try',
      progressPercent: 100,
      terminalAt: new Date().toISOString(),
    });
    state.session = { data: { user: { id: 'user-1' } } };
    state.jobs = { jobs: [finished], active: [], games: [{ id: 'game-1', title: 'Moon Vault' }] };
    renderMenu('/games');
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.getByRole('button', { name: /Build the moon gate.*Finished.*Ready to try.*100%/ })).toBeVisible();

    act(() => vi.advanceTimersByTime(5 * 60 * 1000 + 1));

    expect(screen.queryByRole('group', { name: /Moon Vault builds/ })).not.toBeInTheDocument();
  });

  // Kevin (2026-11-08): the top-right button says how many decisions are open, across every game, including a
  // registered game's Commands that no build job owns; a build's request count alone showed Blobs as 0.
  it('badges every open decision across games, red only when one blocks its build', () => {
    state.session = { data: { user: { id: 'user-1' } } };
    state.decisions = [decision('d1'), decision('d2', { game_id: 'game-castle', game_title: 'Castle' })];

    const view = renderMenu('/games');
    const trigger = screen.getByRole('button', { name: 'Menu' });

    expect(screen.getByText('2', { selector: '.studio-menu-badge' })).toBeVisible();
    expect(trigger).toHaveAttribute('data-blocking', 'false');
    expect(trigger).toHaveAttribute('aria-describedby', 'studio-menu-requests');
    expect(document.getElementById('studio-menu-requests')).toHaveTextContent('2 decisions need your answer');

    view.unmount();
    state.decisions = [decision('d1'), decision('d3', { blocking: true })];
    renderMenu('/games');
    expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute('data-blocking', 'true');
  });

  it('shows no badge to a visitor who is not signed in', () => {
    state.decisions = [decision('d1')];
    renderMenu('/');
    expect(document.querySelector('.studio-menu-badge')).toBeNull();
  });

  it('lists the decisions first by topic, in the order given, and opens the one chosen in the deck', () => {
    state.session = { data: { user: { id: 'user-1' } } };
    state.decisions = [decision('d1', { blocking: true }), decision('d2', { summary: undefined, title: 'Gate' })];
    renderMenu('/games');
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));

    const list = screen.getByRole('list', { name: 'Decisions' });
    expect([...list.querySelectorAll('strong')].map((topic) => topic.textContent)).toEqual(['Topic d1', 'Gate']);
    expect(screen.getByRole('button', { name: 'Topic d1, Blobs' })).toHaveAttribute('data-blocking', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Gate, Blobs' }));

    expect(screen.getByRole('dialog', { name: 'Gate' })).toBeVisible();
    expect(screen.getByText('Which d2?')).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument();
  });

  it('groups jobs by game and distinguishes paused, parked, and playable work', () => {
    const paused = runningJob({
      id: 'job-paused',
      openRequestCount: 2,
      plan: { title: 'Choose the moon gate' },
      stage: 'paused',
      stageText: 'Waiting for your answer',
    });
    const parked = runningJob({
      id: 'job-parked',
      openRequestCount: 1,
      plan: { title: 'Paint the observatory' },
      stage: 'parked',
      stageText: 'Parked',
    });
    const playable = runningJob({
      id: 'job-playable',
      gameId: 'game-2',
      state: 'done',
      stage: 'done',
      stageText: 'Ready to try',
      progressPercent: 100,
      terminalAt: new Date().toISOString(),
      plan: { title: 'Prototype the forest' },
    });
    state.session = { data: { user: { id: 'user-1' } } };
    state.jobs = {
      jobs: [paused, parked, playable],
      active: [paused, parked],
      games: [
        { id: 'game-1', title: 'Moon Vault' },
        { id: 'game-2', title: 'Forest Run' },
      ],
    };

    renderMenu('/games');

    const trigger = screen.getByRole('button', { name: 'Menu' });
    expect(trigger).toHaveAttribute('data-building', 'false');

    fireEvent.click(trigger);
    const moon = screen.getByRole('group', { name: 'Moon Vault builds' });
    expect(moon).toHaveTextContent('Choose the moon gatePausedWaiting for your answer');
    expect(moon).toHaveTextContent('Paint the observatoryParked');
    const forest = screen.getByRole('group', { name: 'Forest Run builds' });
    expect(forest).toHaveTextContent('Ready to try');
    expect(screen.getByRole('button', { name: /Prototype the forest.*Finished.*Ready to try/ })).toHaveAttribute(
      'data-status',
      'finished',
    );
    expect(screen.getByRole('button', { name: /Prototype the forest.*Finished.*Ready to try/ })).toHaveAttribute(
      'data-success',
      'true',
    );
  });

  it('opens the job’s conversation in a modal instead of leaving the screen', () => {
    const job = runningJob();
    state.session = { data: { user: { id: 'user-1' } } };
    state.jobs = { jobs: [job], active: [job], games: [{ id: 'game-1', title: 'Moon Vault' }] };
    renderMenu('/games');
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));

    fireEvent.click(screen.getByRole('button', { name: /Build the moon gate/ }));

    expect(screen.getByRole('dialog', { name: 'Build the moon gate' })).toBeVisible();
    expect(screen.getByText('conversation job-1')).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument();
  });

  it('keeps sign out retryable when the auth request fails', async () => {
    state.session = { data: { user: { id: 'user-1' } } };
    auth.signOut.mockRejectedValueOnce(new Error('offline'));
    renderMenu('/games');
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Sign out failed. Try again.'));
    expect(screen.getByRole('dialog', { name: 'Menu' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
  });

  // The decision row that opened the deck is gone once the menu closes, so closing the deck lands on the menu button.
  it('returns focus to the hamburger when the deck opened from the menu closes', () => {
    state.session = { data: { user: { id: 'user-1' } } };
    state.decisions = [decision('d1')];
    renderMenu('/games');
    const trigger = screen.getByRole('button', { name: 'Menu' });
    fireEvent.click(trigger);
    const row = screen.getByRole('button', { name: 'Topic d1, Blobs' });
    row.focus();
    fireEvent.click(row);

    fireEvent.click(within(screen.getByRole('dialog', { name: 'Topic d1' })).getByRole('button', { name: 'Close' }));

    expect(trigger).toHaveFocus();
  });

  it('closes on Escape and returns focus to the hamburger', () => {
    renderMenu('/games');
    const trigger = screen.getByRole('button', { name: 'Menu' });
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Menu' })).toBeVisible();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

function renderMenu(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <StudioMenu />
    </MemoryRouter>,
  );
}
