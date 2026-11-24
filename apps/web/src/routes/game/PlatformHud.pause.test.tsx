import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SaveSlot } from '@ogm/contracts/browser';

import { GameMenuProvider, useGameMenuControls } from '../../app/GameMenu';
import type { GameFrameController } from '../../features/editor/frame';
import { PlatformHud } from './PlatformHud';

const EXTRAS = { actions: [], extras: [<button key="invite" type="button" aria-label="Invite" />] };
function Extras() {
  useGameMenuControls(EXTRAS);
  return null;
}

function fakeFrame() {
  return {
    onEvent: vi.fn(() => vi.fn()),
    onSaveLoadError: vi.fn(() => vi.fn()),
    onSaveWrite: vi.fn(() => vi.fn()),
    pause: vi.fn(),
    restoreSave: vi.fn(),
    resume: vi.fn(),
    setSettings: vi.fn(),
  } as unknown as GameFrameController & { setSettings: ReturnType<typeof vi.fn> };
}

const saveContext = { branch: 'main', buildId: 'build_01BX5ZZKBKACTAV9WEVGEMMVRZ' };
const slots = [{ slotId: 'auto', headRevision: 1, status: 'ok' }] as SaveSlot[];

function renderPaused(props: Partial<Parameters<typeof PlatformHud>[0]> = {}) {
  const frame = fakeFrame();
  const list = vi.fn().mockResolvedValue({ available: true, value: { slots } });
  render(
    <PlatformHud
      build="draft"
      frame={frame}
      gameId="game"
      paused
      saveContext={saveContext}
      saves
      saveApi={{ list, read: vi.fn(), write: vi.fn() }}
      onLeave={vi.fn()}
      onRestart={vi.fn()}
      onEdit={vi.fn()}
      onResume={vi.fn()}
      {...props}
    />,
  );
  return { frame, list };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('PlatformHud pause panel', () => {
  // Kevin, 2026-11-24 (#1326): play mode is Resume, Restart, Leave, sound and File a bug; no tickets or agent context.
  // Saves and credits still wait in Settings, and Edit stays the way into the editor.
  it('shows only the play actions, with save slots and credits off the panel', async () => {
    const { list } = renderPaused({ onFileBug: vi.fn() });
    await waitFor(() => expect(list).toHaveBeenCalled());
    const panel = screen.getByRole('dialog', { name: 'Paused' });

    const names = within(panel)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent);
    expect(names).toEqual(['Resume', 'Restart', 'Leave', 'Mute', 'File a bug', 'Settings', 'Edit']);
    expect(within(panel).getByRole('slider', { name: 'Volume' })).toBeInTheDocument();
    expect(within(panel).queryByRole('group', { name: 'Save slots' })).not.toBeInTheDocument();
  });

  // Leave sat in the same green as Resume, so a tap meant to keep playing could end the game.
  it('styles Leave as a secondary action, never like Resume', () => {
    renderPaused();

    expect(screen.getByRole('button', { name: 'Resume' })).toHaveClass('is-go');
    expect(screen.getByRole('button', { name: 'Leave' })).not.toHaveClass('is-go');
  });

  it('mutes and unmutes the game from the sound circle', () => {
    const { frame } = renderPaused();

    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));

    expect(frame.setSettings).toHaveBeenLastCalledWith(expect.objectContaining({ mute: true }));
    expect(screen.getByRole('slider', { name: 'Volume' })).toHaveValue('0');
    fireEvent.click(screen.getByRole('button', { name: 'Unmute' }));
    expect(frame.setSettings).toHaveBeenLastCalledWith(expect.objectContaining({ mute: false }));
  });

  it('sets the game volume from the slider and unmutes when it is raised', () => {
    const { frame } = renderPaused();
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));

    fireEvent.change(screen.getByRole('slider', { name: 'Volume' }), { target: { value: '40' } });

    expect(frame.setSettings).toHaveBeenLastCalledWith(expect.objectContaining({ volume: 0.4, mute: false }));
  });

  it('files a bug with the host log and goes back to the menu', async () => {
    const onFileBug = vi.fn().mockResolvedValue({});
    renderPaused({ onFileBug, bugLog: () => 'game game' });

    fireEvent.click(screen.getByRole('button', { name: 'File a bug' }));
    const page = screen.getByRole('dialog', { name: 'File a bug' });
    fireEvent.change(within(page).getByRole('textbox', { name: 'Describe the issue' }), {
      target: { value: 'Frozen goblin' },
    });
    fireEvent.click(within(page).getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(onFileBug).toHaveBeenCalledWith('Frozen goblin', 'game game'));
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    expect(screen.getByRole('dialog', { name: 'Paused' })).toBeVisible();
  });

  it('runs Restart and Edit through the screen and leaves Restart out of room play', () => {
    const onRestart = vi.fn();
    const onEdit = vi.fn();
    renderPaused({ onRestart, onEdit });

    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    expect(onRestart).toHaveBeenCalledOnce();
    expect(onEdit).toHaveBeenCalledOnce();
    cleanup();
    renderPaused({ onRestart: undefined });
    expect(screen.queryByRole('button', { name: 'Restart' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leave' })).toBeVisible();
  });

  // A room peer cannot switch the shared game into edit mode.
  it('disables Edit when the screen says the player may not edit', () => {
    const onEdit = vi.fn();
    renderPaused({ onEdit, editDisabled: true });

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('loads credits again after a failure once the player comes back to Settings', async () => {
    const creditsApi = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ version: 1, packs: [] });
    renderPaused({ saves: false, creditsApi });
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByText('Credits'));
    expect(await screen.findByText('Unavailable')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByText('Credits'));

    await waitFor(() => expect(creditsApi).toHaveBeenCalledTimes(2));
  });

  it("offers More only for the game's own extras", () => {
    renderPaused();
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  });

  it('lends its More page to the studio menu and takes it back on Back', async () => {
    const onMoreHost = vi.fn();
    const frame = fakeFrame();
    render(
      <GameMenuProvider>
        <Extras />
        <PlatformHud
          build="draft"
          frame={frame}
          gameId="game"
          paused
          saves={false}
          saveContext={saveContext}
          saveApi={{ list: vi.fn().mockResolvedValue({ available: false }), read: vi.fn(), write: vi.fn() }}
          onMoreHost={onMoreHost}
          onResume={vi.fn()}
        />
      </GameMenuProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'More' }));

    const host = onMoreHost.mock.calls.at(-1)?.[0] as HTMLElement;
    expect(host).toBeInstanceOf(HTMLElement);
    expect(screen.getByRole('dialog', { name: 'More' })).toContainElement(host);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Back' })).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onMoreHost.mock.calls.at(-1)?.[0]).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Paused' })).toBeVisible();
  });
});
