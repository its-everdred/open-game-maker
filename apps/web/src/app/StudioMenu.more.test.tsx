import { useEffect, useMemo, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GameMenuProvider, useGameMenu, useGameMenuControls } from './GameMenu';
import { StudioMenu } from './StudioMenu';

vi.mock('../features/build-chat/jobs', () => ({
  isTerminal: (value: string) => ['done', 'failed', 'cancelled'].includes(value),
  useMyJobs: () => ({ jobs: [], active: [], games: [] }),
  setJobPaused: vi.fn(),
}));
vi.mock('../features/worker-builds/useWorkers', () => ({ useWorkers: () => ({ workers: [], feeds: [] }) }));
vi.mock('../features/worker-builds/useAdminReviewGames', () => ({
  useAdminReviewGames: () => ({ data: undefined, isError: false, isLoading: false }),
}));
vi.mock('../features/worker-builds/useWorkerReviews', () => ({
  useWorkerReviews: () => ({ reviews: [], error: false, loading: false }),
}));
vi.mock('../features/worker-builds/usePastTickets', () => ({
  usePastTickets: () => ({ tickets: [], error: false, loading: false }),
}));
vi.mock('../features/commands-inbox/commands', () => ({
  useCoreReviewCommands: () => ({ commands: [], targets: [], error: false, loading: false }),
  useCreatorReviewCommands: () => ({ commands: [], error: false, loading: false }),
  useCreatorCommands: () => ({ commands: [], sessions: [] }),
}));
vi.mock('../lib/api/session', () => ({ useSession: () => ({ data: null }) }));
vi.mock('../routes/admin/api', () => ({ useAdminMe: () => ({ data: undefined }) }));
vi.mock('../lib/sound', () => ({
  getVolume: () => 0.75,
  onChange: () => () => undefined,
  setMuted: vi.fn(),
  setVolume: vi.fn(),
  status: () => 'on',
}));

function PendingExtra() {
  const [pending, setPending] = useState(false);
  return (
    <button
      className="menu-circle"
      type="button"
      aria-label={pending ? 'Invite pending' : 'Invite'}
      onClick={() => setPending(true)}
    />
  );
}

function PlayControls() {
  const controls = useMemo(
    () => ({
      actions: [
        { id: 'games', label: 'Games', icon: 'games', onPausePanel: true, onSelect: vi.fn() },
        { id: 'edit', label: 'Edit', icon: 'edit', onPausePanel: true, onSelect: vi.fn() },
        { id: 'ask', label: 'Ask for a change', icon: 'speak', onSelect: vi.fn() },
      ],
      extras: [
        <button key="fork" className="menu-circle" type="button" aria-label="Fork" />,
        <PendingExtra key="invite" />,
      ],
    }),
    [],
  );
  useGameMenuControls(controls);
  return null;
}

/** Stands in for the pause panel: opens the menu like the pause button, and can show its More page. */
function PausePanel() {
  const { open, setOpen, setMoreHost, setPausePanelVisible } = useGameMenu();
  useEffect(() => {
    setPausePanelVisible(open);
    return () => setPausePanelVisible(false);
  }, [open, setPausePanelVisible]);
  const [more, setMore] = useState(false);
  return (
    <div className="platform-pause-dialog" data-studio-menu-boundary>
      <button type="button" onClick={() => setOpen(true)}>
        Pause
      </button>
      <button type="button" onClick={() => setOpen(false)}>
        Resume
      </button>
      <button type="button" onClick={() => setMore((current) => !current)}>
        Toggle more
      </button>
      {more ? <div data-testid="more-host" ref={setMoreHost} /> : null}
    </div>
  );
}

function renderGame() {
  return render(
    <MemoryRouter initialEntries={['/g/game-1']}>
      <GameMenuProvider>
        <StudioMenu />
        <PlayControls />
        <PausePanel />
      </GameMenuProvider>
    </MemoryRouter>,
  );
}

function circleNames() {
  return [...screen.getByRole('group', { name: 'Menu' }).querySelectorAll('.menu-circle')].map((circle) =>
    circle.getAttribute('aria-label'),
  );
}

afterEach(cleanup);

describe('StudioMenu inside the pause panel', () => {
  it('returns focus to the trigger after the pause panel closes', async () => {
    renderGame();
    await screen.findByRole('button', { name: 'Menu' });
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(screen.queryByRole('button', { name: 'Menu' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Menu' })).toHaveFocus());
  });
  // The editor's menu is its own paused modal (#1326), with Resume in its header; see the test below.
  it.each(['/g/showcase/example'])('keeps the trigger available without a pause panel at %s', async (path) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <GameMenuProvider>
          <StudioMenu />
          <PlayControls />
        </GameMenuProvider>
      </MemoryRouter>,
    );
    const trigger = await screen.findByRole('button', { name: 'Menu' });
    fireEvent.click(trigger);
    expect(trigger).toBeVisible();
  });
  it('opens the paused modal in the editor and hides the trigger behind it', async () => {
    render(
      <MemoryRouter initialEntries={['/g/game-1?mode=edit']}>
        <GameMenuProvider>
          <StudioMenu />
          <PlayControls />
        </GameMenuProvider>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Menu' }));
    expect(screen.getByRole('dialog', { name: 'Paused' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Menu' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(screen.getByRole('button', { name: 'Menu' })).toBeVisible();
  });

  // Kevin, 2026-11-18: the studio circles sprayed over the game's pause panel. On the panel's More page they must
  // render inside it, without repeating what the panel already shows (Leave, Edit, Sound).
  it('moves the tray into the More page and drops the circles the pause panel already offers', async () => {
    renderGame();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute('data-game-play', 'true'));
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(screen.queryByRole('button', { name: 'Menu' })).toBeNull();
    expect(circleNames()).toEqual(expect.arrayContaining(['Games', 'Edit', 'Mute']));

    fireEvent.click(screen.getByRole('button', { name: 'Toggle more' }));

    const host = screen.getByTestId('more-host');
    expect(host).toContainElement(screen.getByRole('group', { name: 'Menu' }));
    // Play mode carries no tickets or agent context (#1326): More holds only the game's own extras.
    expect(circleNames()).toEqual(['Fork', 'Invite']);
    expect(circleNames()).not.toContain('Games');
    expect(circleNames()).not.toContain('Edit');
    expect(circleNames()).not.toContain('Mute');
  });

  it('returns the tray to the studio control when the More page closes', async () => {
    const { container } = renderGame();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute('data-game-play', 'true'));
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle more' }));

    fireEvent.click(screen.getByRole('button', { name: 'Toggle more' }));

    expect(container.querySelector('.studio-menu-control')).toContainElement(
      screen.getByRole('group', { name: 'Menu' }),
    );
    expect(circleNames()).toContain('Games');
  });

  // A remount would drop an invite already in flight, and a second tap would then create a second room.
  it('keeps a game extra mounted, with its state, across the More page', async () => {
    renderGame();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute('data-game-play', 'true'));
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle more' }));
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }));

    fireEvent.click(screen.getByRole('button', { name: 'Toggle more' }));
    expect(screen.getByRole('button', { name: 'Invite pending' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Toggle more' }));

    expect(screen.getByTestId('more-host')).toContainElement(screen.getByRole('button', { name: 'Invite pending' }));
  });
});
