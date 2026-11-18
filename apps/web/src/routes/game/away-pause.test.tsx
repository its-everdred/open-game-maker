import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SaveData } from '@ogm/contracts/browser';

import type { GameFrameController } from '../../features/editor/frame';
import { FOCUS_POLL_MS, useAwayPause } from './away-pause';

function fakeFrame() {
  const saveListeners = new Set<(save: SaveData<unknown>) => void>();
  const frame = {
    pause: vi.fn(),
    restoreSave: vi.fn(),
    onSaveWrite: vi.fn((callback: (save: SaveData<unknown>) => void) => {
      saveListeners.add(callback);
      return () => saveListeners.delete(callback);
    }),
  };
  const write = (save: SaveData<unknown> & { reason?: string }) => {
    for (const listener of saveListeners) listener(save);
  };
  return { frame, controller: frame as unknown as GameFrameController, write };
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

type Props = Parameters<typeof useAwayPause>[0];

function mount(props: Partial<Props> & Pick<Props, 'frame'>) {
  const openMenu = vi.fn();
  const initial: Props = { gameId: 'game', buildId: 'b1', solo: true, menuOpen: false, openMenu, ...props };
  const hook = renderHook((current: Props) => useAwayPause(current), { initialProps: initial });
  return { ...hook, openMenu, initial };
}

describe('useAwayPause (#874)', () => {
  let focused = true;

  beforeEach(() => {
    focused = true;
    vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(document, 'visibilityState');
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('opens the pause menu when the page hides and keeps the game save for a reload', () => {
    const { controller, write } = fakeFrame();
    const { openMenu } = mount({ frame: controller });
    write({ saveSchemaVersion: 1, data: { counter: 4 }, reason: 'interval' });

    act(() => setVisibility('hidden'));
    // The SDK writes its own save as the page hides; that later state is the one a reload restores.
    write({ saveSchemaVersion: 1, data: { counter: 7 }, reason: 'hidden' });

    expect(openMenu).toHaveBeenCalledOnce();
    expect(JSON.parse(sessionStorage.getItem('ogm.away.game')!)).toEqual({
      buildId: 'b1',
      save: { saveSchemaVersion: 1, data: { counter: 7 } },
    });
  });

  it('pauses on pagehide, where iOS may evict the tab without a visibility change', () => {
    const { controller } = fakeFrame();
    const { openMenu } = mount({ frame: controller });
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(openMenu).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem('ogm.away.game')).not.toBeNull();
  });

  it('pauses when the app loses focus with the game frame focused, but not for a page that never had focus', () => {
    vi.useFakeTimers();
    const { controller } = fakeFrame();
    focused = false;
    const background = mount({ frame: controller });
    act(() => vi.advanceTimersByTime(FOCUS_POLL_MS * 3));
    expect(background.openMenu).not.toHaveBeenCalled();
    background.unmount();

    focused = true;
    const { openMenu } = mount({ frame: controller });
    // Focus moving into the game frame blurs the shell window but leaves the document focused: not a leave.
    act(() => {
      window.dispatchEvent(new Event('blur'));
      vi.advanceTimersByTime(FOCUS_POLL_MS);
    });
    expect(openMenu).not.toHaveBeenCalled();
    // The app switcher: no event reaches the shell, and the poll sees the focus go.
    focused = false;
    act(() => vi.advanceTimersByTime(FOCUS_POLL_MS));
    expect(openMenu).toHaveBeenCalledOnce();
  });

  it('reloads an evicted tab into the same paused state', () => {
    sessionStorage.setItem(
      'ogm.away.game',
      JSON.stringify({ buildId: 'b1', save: { saveSchemaVersion: 1, data: { counter: 7 } } }),
    );
    const { frame, controller } = fakeFrame();
    const { openMenu } = mount({ frame: controller });
    expect(frame.pause).toHaveBeenCalledOnce();
    expect(frame.restoreSave).toHaveBeenCalledWith({ saveSchemaVersion: 1, data: { counter: 7 } });
    expect(openMenu).toHaveBeenCalledOnce();
    expect(frame.pause.mock.invocationCallOrder[0]).toBeLessThan(frame.restoreSave.mock.invocationCallOrder[0]!);
  });

  it('waits for the game frame before restoring, and restores once', () => {
    sessionStorage.setItem('ogm.away.game', JSON.stringify({ buildId: 'b1', save: { saveSchemaVersion: 1, data: 1 } }));
    const { frame, controller } = fakeFrame();
    const { rerender, initial } = mount({ frame: undefined });
    expect(frame.restoreSave).not.toHaveBeenCalled();
    rerender({ ...initial, frame: controller });
    rerender({ ...initial, frame: controller, menuOpen: true });
    expect(frame.restoreSave).toHaveBeenCalledOnce();
  });

  it('starts another build paused without restoring a save it may not read', () => {
    sessionStorage.setItem(
      'ogm.away.game',
      JSON.stringify({ buildId: 'old', save: { saveSchemaVersion: 1, data: 1 } }),
    );
    const { frame, controller } = fakeFrame();
    const { openMenu } = mount({ frame: controller });
    expect(frame.restoreSave).not.toHaveBeenCalled();
    expect(openMenu).toHaveBeenCalledOnce();
  });

  it('forgets the snapshot once the player resumes, so later saves do not bring it back', () => {
    const { controller, write } = fakeFrame();
    const { rerender, initial } = mount({ frame: controller });
    act(() => setVisibility('hidden'));
    rerender({ ...initial, menuOpen: true });
    act(() => setVisibility('visible'));
    expect(sessionStorage.getItem('ogm.away.game')).not.toBeNull();

    rerender({ ...initial, menuOpen: false });
    write({ saveSchemaVersion: 1, data: { counter: 9 } });
    expect(sessionStorage.getItem('ogm.away.game')).toBeNull();
  });

  it('pauses a room for everyone but keeps no local snapshot, since the room holds the match', () => {
    sessionStorage.setItem('ogm.away.game', JSON.stringify({ buildId: 'b1', save: { saveSchemaVersion: 1, data: 1 } }));
    const { frame, controller } = fakeFrame();
    const { openMenu } = mount({ frame: controller, solo: false });
    expect(frame.restoreSave).not.toHaveBeenCalled();
    sessionStorage.clear();
    act(() => setVisibility('hidden'));
    expect(openMenu).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem('ogm.away.game')).toBeNull();
  });

  it('keeps the restored game through a second eviction before the player resumes', () => {
    const save = { saveSchemaVersion: 1, data: { counter: 7 } };
    sessionStorage.setItem('ogm.away.game', JSON.stringify({ buildId: 'b1', save }));
    const { controller } = fakeFrame();
    const { rerender, initial } = mount({ frame: controller });
    rerender({ ...initial, frame: controller, menuOpen: true });
    // The paused game writes no new save, so the second leave must keep the one it was restored from.
    act(() => setVisibility('hidden'));
    expect(JSON.parse(sessionStorage.getItem('ogm.away.game')!)).toEqual({ buildId: 'b1', save });
  });

  it('starts fresh next time when the player leaves play inside the app while paused', () => {
    const { controller, write } = fakeFrame();
    const { unmount } = mount({ frame: controller });
    write({ saveSchemaVersion: 1, data: { counter: 4 } });
    act(() => setVisibility('hidden'));
    expect(sessionStorage.getItem('ogm.away.game')).not.toBeNull();
    unmount();
    expect(sessionStorage.getItem('ogm.away.game')).toBeNull();
  });

  it('ignores a blur whose focus check lands after play has ended', () => {
    vi.useFakeTimers();
    const { controller } = fakeFrame();
    const { openMenu, unmount } = mount({ frame: controller });
    focused = false;
    window.dispatchEvent(new Event('blur'));
    unmount();
    act(() => vi.advanceTimersByTime(FOCUS_POLL_MS));
    expect(openMenu).not.toHaveBeenCalled();
  });

  it('restores the next game opened in the same screen too', () => {
    const { frame, controller } = fakeFrame();
    const { rerender, initial } = mount({ frame: controller });
    expect(frame.restoreSave).not.toHaveBeenCalled();
    sessionStorage.setItem(
      'ogm.away.other',
      JSON.stringify({ buildId: 'b1', save: { saveSchemaVersion: 1, data: 2 } }),
    );
    rerender({ ...initial, frame: controller, gameId: 'other' });
    expect(frame.restoreSave).toHaveBeenCalledWith({ saveSchemaVersion: 1, data: 2 });
  });
});
