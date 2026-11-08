import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GameCommand } from '@ogm/contracts';
import type { EnergyView } from '@ogm/contracts/browser';

import { useDeckDraft, useReviewDraft } from '../features/commands-inbox/drafts';
import { StudioMenu } from './StudioMenu';

const state = vi.hoisted(() => ({
  admin: { data: undefined as { platformRole: 'maintainer' | 'admin' | 'none' } | undefined },
  jobs: { jobs: [] as TestJob[], active: [] as TestJob[], games: [] as Array<{ id: string; title: string }> },
  session: { data: null as { user: { id: string } } | null },
  energy: { data: undefined as EnergyView | undefined },
}));

const sound = vi.hoisted(() => ({
  getVolume: vi.fn(() => 0.75),
  onChange: vi.fn(() => () => undefined),
  setMuted: vi.fn(),
  setVolume: vi.fn(),
  status: vi.fn(() => 'on' as const),
}));
const auth = vi.hoisted(() => ({ signOut: vi.fn() }));
const report = vi.hoisted(() => ({ sendReport: vi.fn() }));

vi.mock('../features/build-chat/jobs', () => ({
  isTerminal: (value: string) => ['done', 'failed', 'cancelled'].includes(value),
  useMyJobs: () => state.jobs,
}));
vi.mock('../features/build-chat/Chat', () => ({
  Chat: ({ jobId }: { jobId?: string }) => <p>conversation {jobId}</p>,
}));
vi.mock('../lib/api/session', () => ({ useSession: () => state.session }));
vi.mock('../lib/api/auth', () => auth);
vi.mock('../features/bug-report/send', () => report);
vi.mock('../lib/sound', () => sound);
vi.mock('../routes/admin/api', () => ({ useAdminMe: () => state.admin }));
vi.mock('../features/energy/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../features/energy/api')>()),
  useEnergy: () => state.energy,
}));

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
  state.energy = { data: undefined };
  sound.setMuted.mockReset();
  sound.setVolume.mockReset();
  auth.signOut.mockReset();
  report.sendReport.mockReset();
  vi.useRealTimers();
});

describe('StudioMenu', () => {
  it('opens the always-available controls on the title without signed-in links', () => {
    renderMenu('/');

    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));

    expect(circleNames()).toEqual(['Mute', 'Report a problem']);
    expect(ringOf(screen.getByRole('button', { name: 'Mute' }))).toBe('75 100');
    expect(screen.queryByRole('link', { name: 'Credits' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Versions' })).not.toBeInTheDocument();
  });

  // Kevin (2026-11-08): the menu expands a row of circles beside the button, not a dropdown panel; details open only
  // for the circle tapped, and the menu button or a tap outside folds the row away.
  it('expands circles nearest-first with no panel, and folds on the menu button or a tap outside', () => {
    // Its own id: the start announcement is remembered per job across tests.
    const job = runningJob({ id: 'job-row' });
    state.session = { data: { user: { id: 'user-1' } } };
    state.jobs = { jobs: [job], active: [job], games: [{ id: 'game-1', title: 'Moon Vault' }] };
    renderMenu('/games');
    const trigger = screen.getByRole('button', { name: 'Menu' });

    fireEvent.click(trigger);
    expect(circleNames()).toEqual([
      'Builds: 42%',
      'Energy: Unknown',
      'Mute',
      'Report a problem',
      'Credits',
      'Sign out',
    ]);
    expect(document.querySelector('.studio-menu-sheet')).toBeNull();

    fireEvent.click(trigger);
    expect(screen.queryByRole('group', { name: 'Menu' })).not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('group', { name: 'Menu' })).not.toBeInTheDocument();
  });

  it('mutes on a tap, sets the level by dragging or arrow keys, and opens the slider on a long press', () => {
    vi.useFakeTimers();
    renderMenu('/');
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    const volume = screen.getByRole('button', { name: 'Mute' });

    fireEvent.click(volume);
    expect(sound.setMuted).toHaveBeenCalledWith(true);

    sound.setMuted.mockReset();
    fireEvent.pointerDown(volume, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(volume, { clientX: 100, clientY: 76 });
    fireEvent.pointerUp(volume);
    fireEvent.click(volume);
    expect(sound.setVolume).toHaveBeenLastCalledWith(0.95);
    expect(ringOf(volume)).toBe('95 100');
    expect(sound.setMuted).not.toHaveBeenCalled();

    fireEvent.keyDown(volume, { key: 'ArrowDown' });
    expect(sound.setVolume).toHaveBeenLastCalledWith(0.9);

    fireEvent.pointerDown(volume, { clientX: 100, clientY: 100 });
    act(() => vi.advanceTimersByTime(450));
    fireEvent.pointerUp(volume);
    fireEvent.click(volume);
    expect(screen.getByRole('slider', { name: 'Volume' })).toHaveValue('0.9');
    expect(sound.setMuted).not.toHaveBeenCalled();
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

  it('rings what is left of the tightest Energy window and opens the windows, then settings', () => {
    state.session = { data: { user: { id: 'user-1' } } };
    state.energy = {
      data: {
        level: 'limited',
        preference: 'balanced',
        windows: [
          { window: 'day', usedPercent: 40, resetsAt: '2026-11-09T08:00:00.000Z' },
          { window: 'week', usedPercent: 80, resetsAt: '2026-11-09T08:00:00.000Z' },
          { window: 'month', usedPercent: null, resetsAt: '2026-12-01T08:00:00.000Z' },
        ],
        services: [
          { service: 'voice', usedPercent: null },
          { service: 'images', usedPercent: null },
        ],
      },
    };

    renderMenu('/games');
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    const energy = screen.getByRole('button', { name: 'Energy: Limited' });
    expect(energy.querySelector('circle:last-child')).toHaveAttribute('stroke-dasharray', '20 100');
    expect(screen.queryByRole('link', { name: 'Energy settings' })).not.toBeInTheDocument();

    fireEvent.click(energy);
    const detail = screen.getByRole('link', { name: 'Energy settings' });
    expect(detail).toHaveAttribute('href', '/settings/energy');
    expect(detail).toHaveTextContent(/Today.*60% left.*This week.*20% left.*This month.*Unknown/);
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
    const builds = screen.getByRole('button', { name: 'Builds: 42%' });
    expect(ringOf(builds)).toBe('42 100');
    fireEvent.click(builds);
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
    fireEvent.click(screen.getByRole('button', { name: 'Builds: 100%' }));
    expect(screen.getByRole('button', { name: /Build the moon gate.*Finished.*Ready to try.*100%/ })).toBeVisible();

    act(() => vi.advanceTimersByTime(5 * 60 * 1000 + 1));

    expect(screen.queryByRole('group', { name: /Moon Vault builds/ })).not.toBeInTheDocument();
    // No empty sheet is left hanging under the row once its builds are gone.
    expect(document.querySelector('.studio-menu-sheet')).toBeNull();
  });

  it('groups jobs by game, badges open requests, and distinguishes paused, parked, and playable work', () => {
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
    expect(trigger).toHaveAttribute('aria-describedby', 'studio-menu-requests');
    expect(screen.getByText('3', { selector: '.studio-menu-badge' })).toBeVisible();
    expect(document.getElementById('studio-menu-requests')).toHaveTextContent('3 requests need your attention');

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: /^Builds: / }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Builds: 42%' }));

    fireEvent.click(screen.getByRole('button', { name: /Build the moon gate/ }));

    expect(screen.getByRole('dialog', { name: 'Build the moon gate' })).toBeVisible();
    expect(screen.getByText('conversation job-1')).toBeVisible();
    expect(screen.queryByRole('group', { name: 'Menu' })).not.toBeInTheDocument();
  });

  it('opens the problem report under the row, sends it and folds the sheet, or closes it unsent', async () => {
    report.sendReport.mockResolvedValueOnce(undefined);
    renderMenu('/');
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));

    fireEvent.click(screen.getByRole('button', { name: 'Report a problem' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'What went wrong?' }), { target: { value: 'Gate stuck' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.queryByRole('form', { name: 'Report a problem' })).not.toBeInTheDocument());
    expect(report.sendReport).toHaveBeenCalledWith({ text: 'Gate stuck' });
    expect(screen.getByRole('group', { name: 'Menu' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Report a problem' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('form', { name: 'Report a problem' })).not.toBeInTheDocument();
  });

  // A slow report must not close the sheet of the circle the creator tapped while it was sending.
  it('keeps another circle’s sheet open when a slow report finishes', async () => {
    let finish: () => void = () => undefined;
    report.sendReport.mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)));
    renderMenu('/');
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Report a problem' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    vi.useFakeTimers();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Mute' }), { clientX: 0, clientY: 0 });
    act(() => vi.advanceTimersByTime(450));
    vi.useRealTimers();
    expect(screen.getByRole('slider', { name: 'Volume' })).toBeVisible();

    await act(async () => finish());

    expect(screen.getByRole('slider', { name: 'Volume' })).toBeVisible();
  });

  // Review drafts live in memory until sent; the next person signing in on the same device must not find them.
  it('clears unsent review drafts on sign out', async () => {
    state.session = { data: { user: { id: 'user-1' } } };
    auth.signOut.mockResolvedValueOnce(undefined);
    const draft = { checkpoint_id: 'cp_1', version: 1 } as GameCommand;
    const { result } = renderHook(() => ({ edit: useDeckDraft(draft)[1], draft: useReviewDraft(draft) }));
    act(() => result.current.edit({ type: 'judge', optionId: 'a', verdict: 'like' }));
    expect(result.current.draft.deck.cards).toHaveLength(1);
    renderMenu('/games');
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(result.current.draft.deck.cards).toEqual([]));
  });

  it('keeps sign out retryable when the auth request fails', async () => {
    state.session = { data: { user: { id: 'user-1' } } };
    auth.signOut.mockRejectedValueOnce(new Error('offline'));
    renderMenu('/games');
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Sign out failed. Try again.'));
    expect(screen.getByRole('group', { name: 'Menu' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
  });

  it('closes on Escape and returns focus to the hamburger', () => {
    renderMenu('/games');
    const trigger = screen.getByRole('button', { name: 'Menu' });
    fireEvent.click(trigger);
    expect(screen.getByRole('group', { name: 'Menu' })).toBeVisible();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('group', { name: 'Menu' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

function circleNames() {
  return [...screen.getByRole('group', { name: 'Menu' }).querySelectorAll('.menu-circle')].map((circle) =>
    circle.getAttribute('aria-label'),
  );
}

function ringOf(circle: HTMLElement) {
  return circle.querySelector('.menu-circle-ring circle:nth-child(2)')?.getAttribute('stroke-dasharray');
}

function renderMenu(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <StudioMenu />
    </MemoryRouter>,
  );
}
