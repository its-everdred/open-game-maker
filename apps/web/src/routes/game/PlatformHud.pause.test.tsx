import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SaveSlot } from '@ogm/contracts/browser';

import type { GameFrameController } from '../../features/editor/frame';
import { PlatformHud } from './PlatformHud';

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
  // Kevin, 2026-11-15: "waaaay too much going on … no idea what the numbers do". He picked layout C: Resume, then
  // Restart and Leave, then round icons; saves and credits wait in Settings, everything else behind More.
  it('shows only the picked actions, with save slots and credits off the panel', async () => {
    const { list } = renderPaused();
    await waitFor(() => expect(list).toHaveBeenCalled());
    const panel = screen.getByRole('dialog', { name: 'Paused' });

    const names = within(panel)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent);
    expect(names).toEqual(['Resume', 'Restart', 'Leave', 'Sound', 'Settings', 'Edit', 'More']);
    expect(within(panel).queryByRole('group', { name: 'Save slots' })).not.toBeInTheDocument();
  });

  // Leave sat in the same green as Resume, so a tap meant to keep playing could end the game.
  it('styles Leave as a secondary action, never like Resume', () => {
    renderPaused();

    expect(screen.getByRole('button', { name: 'Resume' })).toHaveClass('tap-primary');
    expect(screen.getByRole('button', { name: 'Leave' })).not.toHaveClass('tap-primary');
    expect(screen.getByRole('button', { name: 'Leave' })).toHaveClass('tap-secondary');
  });

  it('mutes and unmutes the game from the sound circle', () => {
    const { frame } = renderPaused();
    const sound = screen.getByRole('button', { name: 'Sound' });
    expect(sound).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(sound);

    expect(sound).toHaveAttribute('aria-pressed', 'false');
    expect(frame.setSettings).toHaveBeenLastCalledWith(expect.objectContaining({ mute: true }));
    fireEvent.click(sound);
    expect(frame.setSettings).toHaveBeenLastCalledWith(expect.objectContaining({ mute: false }));
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

  it('lends its More page to the studio menu and takes it back on Back', async () => {
    const onMoreHost = vi.fn();
    renderPaused({ onMoreHost });

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
