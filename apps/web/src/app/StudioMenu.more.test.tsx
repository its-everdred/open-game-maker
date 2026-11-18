import { useMemo, useState } from 'react';
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

function PlayControls() {
  const controls = useMemo(
    () => ({
      actions: [
        { id: 'games', label: 'Games', icon: 'games', onSelect: vi.fn() },
        { id: 'edit', label: 'Edit', icon: 'edit', onSelect: vi.fn() },
        { id: 'ask', label: 'Ask for a change', icon: 'speak', onSelect: vi.fn() },
      ],
      extras: [<button key="fork" className="menu-circle" type="button" aria-label="Fork" />],
    }),
    [],
  );
  useGameMenuControls(controls);
  return null;
}

/** Stands in for the pause panel: opens the menu like the pause button, and can show its More page. */
function PausePanel() {
  const { setOpen, setMoreHost } = useGameMenu();
  const [more, setMore] = useState(false);
  return (
    <div className="platform-pause-dialog" data-studio-menu-boundary>
      <button type="button" onClick={() => setOpen(true)}>
        Pause
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
  // Kevin, 2026-11-18: the studio circles sprayed over the game's pause panel. On the panel's More page they must
  // render inside it, without repeating what the panel already shows (Leave, Edit, Sound).
  it('moves the tray into the More page and drops the circles the pause panel already offers', async () => {
    renderGame();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute('data-game-play', 'true'));
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(circleNames()).toEqual(expect.arrayContaining(['Games', 'Edit', 'Mute']));

    fireEvent.click(screen.getByRole('button', { name: 'Toggle more' }));

    const host = screen.getByTestId('more-host');
    expect(host).toContainElement(screen.getByRole('group', { name: 'Menu' }));
    expect(circleNames()).toEqual(expect.arrayContaining(['Ask for a change', 'Fork', 'Report a problem']));
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
});
