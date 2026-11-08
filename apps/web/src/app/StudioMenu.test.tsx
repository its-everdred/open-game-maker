import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
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
  decisions: [] as TestDecision[],
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
vi.mock('../features/commands-inbox/commands', () => ({
  answerCommand: vi.fn(async () => undefined),
  useCreatorCommands: (creatorId: string | undefined) => ({ commands: creatorId ? state.decisions : [] }),
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
    fireEvent.pointerMove(volume, { clientX: 100, clientY: 76, buttons: 1 });
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

  // A press that never becomes a click (a right-click, a cancelled touch) must not leave the level following the
  // mouse: only a held primary press drags.
  it('changes the level only while the primary button is held', () => {
    renderMenu('/');
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    const volume = screen.getByRole('button', { name: 'Mute' });

    fireEvent.pointerDown(volume, { clientX: 100, clientY: 100, button: 2 });
    fireEvent.pointerMove(volume, { clientX: 100, clientY: 40, buttons: 2 });
    fireEvent.pointerUp(volume, { button: 2 });
    fireEvent.pointerMove(volume, { clientX: 100, clientY: 20 });

    fireEvent.pointerDown(volume, { clientX: 100, clientY: 100 });
    fireEvent.pointerUp(volume);
    fireEvent.pointerMove(volume, { clientX: 100, clientY: 40 });

    expect(sound.setVolume).not.toHaveBeenCalled();
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
    expect(screen.getByRole('button', { name: 'Decisions: 2' })).toHaveAttribute('data-blocking', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Decisions: 2' }));

    const list = screen.getByRole('list', { name: 'Decisions' });
    expect([...list.querySelectorAll('strong')].map((topic) => topic.textContent)).toEqual(['Topic d1', 'Gate']);
    expect(screen.getByRole('button', { name: 'Topic d1, Blobs' })).toHaveAttribute('data-blocking', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Gate, Blobs' }));

    expect(screen.getByRole('dialog', { name: 'Gate' })).toBeVisible();
    expect(screen.getByText('Which d2?')).toBeVisible();
    expect(screen.queryByRole('group', { name: 'Menu' })).not.toBeInTheDocument();
  });

  // On a shared device, a decision one creator opened must not stay on screen, answerable, for the next account.
  it('closes the open decision when another creator signs in', () => {
    state.session = { data: { user: { id: 'user-1' } } };
    state.decisions = [decision('d1')];
    const view = renderMenu('/games');
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Decisions: 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Topic d1, Blobs' }));
    expect(screen.getByRole('dialog', { name: 'Topic d1' })).toBeVisible();

    state.session = { data: { user: { id: 'user-2' } } };
    view.rerender(
      <MemoryRouter initialEntries={['/games']}>
        <StudioMenu />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('dialog', { name: 'Topic d1' })).not.toBeInTheDocument();

    // Nor does it come back when the first creator signs in again.
    state.session = { data: { user: { id: 'user-1' } } };
    view.rerender(
      <MemoryRouter initialEntries={['/games']}>
        <StudioMenu />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('dialog', { name: 'Topic d1' })).not.toBeInTheDocument();
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
    state.decisions = [decision('d1'), decision('d2'), decision('d3')];
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

    // Kevin (2026-11-08, #632/#596): open decisions are one of the circles, first in the row, and lead to the work
    // waiting on an answer.
    fireEvent.click(trigger);
    expect(circleNames()[0]).toBe('Decisions: 3');
    expect(trigger.querySelector('.studio-menu-badge')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Decisions: 3' }));
    expect(screen.getByRole('list', { name: 'Decisions' })).toBeVisible();
    expect(screen.queryByRole('list', { name: 'Build progress' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Decisions: 3' }));
    expect(screen.queryByRole('list', { name: 'Decisions' })).not.toBeInTheDocument();
    // Each circle owns its sheet: going from Decisions to Builds switches, it does not fold the list away.
    fireEvent.click(screen.getByRole('button', { name: 'Decisions: 3' }));
    fireEvent.click(screen.getByRole('button', { name: /^Builds: / }));
    expect(screen.getByRole('list', { name: 'Build progress' })).toBeVisible();
    expect(screen.getByRole('button', { name: /^Builds: / })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Decisions: 3' })).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByRole('button', { name: /^Builds: / }));

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

  // Tapping another circle while a report is sending must not lose what was typed or that it failed.
  it('keeps the report text and its failure across a switch to another circle', async () => {
    let fail: () => void = () => undefined;
    report.sendReport.mockReturnValueOnce(new Promise<void>((_, reject) => (fail = () => reject(new Error('down')))));
    state.session = { data: { user: { id: 'user-1' } } };
    renderMenu('/');
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Report a problem' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'What went wrong?' }), { target: { value: 'Gate stuck' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    fireEvent.click(screen.getByRole('button', { name: /^Energy/ }));
    await act(async () => fail());
    fireEvent.click(screen.getByRole('button', { name: 'Report a problem' }));

    const text = screen.getByRole('textbox', { name: 'What went wrong?' });
    expect(text).toHaveValue('Gate stuck');
    expect(text).toHaveAttribute('aria-invalid', 'true');
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

  // The decision row that opened the deck is gone once the menu closes, so closing the deck lands on the menu button.
  it('returns focus to the hamburger when the deck opened from the menu closes', () => {
    state.session = { data: { user: { id: 'user-1' } } };
    state.decisions = [decision('d1')];
    renderMenu('/games');
    const trigger = screen.getByRole('button', { name: 'Menu' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Decisions: 1' }));
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
