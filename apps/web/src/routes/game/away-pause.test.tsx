import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SaveData } from '@ogm/contracts/browser';

import type { GameFrameController } from '../../features/editor/frame';
import { FOCUS_POLL_MS, useAwayPause, useEarlyAwayHold } from './away-pause';

function fakeFrame() {
  const saveListeners = new Set<(save: SaveData<unknown>) => void>();
  const frame = {
    pause: vi.fn(),
    restoreSave: vi.fn(),
    onSaveWrite: vi.fn((callback: (save: SaveData<unknown>) => void) => {
      saveListeners.add(callback);
      return () => saveListeners.delete(callback);
    }),
    observeSaveWrite: vi.fn((callback: (save: SaveData<unknown>) => void) => {
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

  it('tracks a connecting frame without consuming startup save writes', () => {
    const { frame, controller } = fakeFrame();
    const { rerender, initial } = mount({ frame: controller, captureSaves: false });
    expect(frame.onSaveWrite).not.toHaveBeenCalled();
    rerender({ ...initial, captureSaves: true });
    expect(frame.observeSaveWrite).toHaveBeenCalledOnce();
    expect(frame.onSaveWrite).not.toHaveBeenCalled();
  });

  it('opens the menu if the document is already hidden when tracking starts', () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    const { controller } = fakeFrame();
    const { openMenu } = mount({ frame: controller, captureSaves: false });
    expect(openMenu).toHaveBeenCalledOnce();
  });

  it('retains a hide and return before the frame has mounted', () => {
    const hold = { current: false };
    const open = vi.fn();
    renderHook(() => useEarlyAwayHold(true, 'game', hold, open));
    act(() => {
      setVisibility('hidden');
      setVisibility('visible');
    });
    expect(hold.current).toBe(true);
    expect(open).toHaveBeenCalledOnce();
  });

  it('records an early pagehide without replacing an existing snapshot', () => {
    const hold = { current: false };
    const open = vi.fn();
    const existing = JSON.stringify({ buildId: 'b1', save: { saveSchemaVersion: 1, data: 7 } });
    sessionStorage.setItem('ogm.away.game', existing);
    renderHook(() => useEarlyAwayHold(true, 'game', hold, open));
    act(() => window.dispatchEvent(new Event('pagehide')));
    expect(hold.current).toBe(true);
    expect(sessionStorage.getItem('ogm.away.game')).toBe(existing);
    sessionStorage.removeItem('ogm.away.game');
    act(() => window.dispatchEvent(new Event('pagehide')));
    expect(JSON.parse(sessionStorage.getItem('ogm.away.game')!)).toEqual({ buildId: '' });
  });

  it('holds startup when focus is lost before the frame mounts', () => {
    vi.useFakeTimers();
    let focused = true;
    vi.mocked(document.hasFocus).mockImplementation(() => focused);
    const hold = { current: false };
    const open = vi.fn();
    renderHook(() => useEarlyAwayHold(true, 'game', hold, open));
    focused = false;
    act(() => {
      window.dispatchEvent(new Event('blur'));
      vi.advanceTimersByTime(0);
    });
    focused = true;
    expect(hold.current).toBe(true);
    expect(open).toHaveBeenCalledOnce();
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
    expect(frame.restoreSave).not.toHaveBeenCalled();
    expect(openMenu).toHaveBeenCalledOnce();
  });

  it('waits for the game frame before restoring, and restores once', () => {
    sessionStorage.setItem('ogm.away.game', JSON.stringify({ buildId: 'b1', save: { saveSchemaVersion: 1, data: 1 } }));
    const { frame, controller } = fakeFrame();
    const { rerender, initial, openMenu } = mount({ frame: undefined });
    expect(frame.restoreSave).not.toHaveBeenCalled();
    rerender({ ...initial, frame: controller });
    rerender({ ...initial, frame: controller, menuOpen: true });
    expect(openMenu).toHaveBeenCalledOnce();
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

  it('retains a restored snapshot until a later save is persisted', () => {
    const save = { saveSchemaVersion: 1, data: { counter: 7 } };
    sessionStorage.setItem('ogm.away.game', JSON.stringify({ buildId: 'b1', save }));
    const { controller, write } = fakeFrame();
    const { result, rerender, initial } = mount({ frame: controller });
    rerender({ ...initial, menuOpen: true });
    rerender({ ...initial, menuOpen: false });
    expect(JSON.parse(sessionStorage.getItem('ogm.away.game')!)).toEqual({ buildId: 'b1', save });
    const next = { saveSchemaVersion: 1, data: { counter: 8 } };
    act(() => write(next));
    expect(JSON.parse(sessionStorage.getItem('ogm.away.game')!)).toEqual({ buildId: 'b1', save: next });
    act(() => result.current.onSavePersisted(save));
    expect(JSON.parse(sessionStorage.getItem('ogm.away.game')!)).toEqual({ buildId: 'b1', save: next });
    act(() => result.current.onSavePersisted(next));
    expect(sessionStorage.getItem('ogm.away.game')).toBeNull();
  });

  it('forgets a restored snapshot when restarting', () => {
    sessionStorage.setItem('ogm.away.game', JSON.stringify({ buildId: 'b1', save: { saveSchemaVersion: 1, data: 7 } }));
    const { controller } = fakeFrame();
    const { result } = mount({ frame: controller });
    act(() => result.current.resetAway());
    expect(sessionStorage.getItem('ogm.away.game')).toBeNull();
  });

  it('ignores an old game save completing after another game opens', () => {
    const save = { saveSchemaVersion: 1, data: 7 };
    sessionStorage.setItem('ogm.away.game', JSON.stringify({ buildId: 'b1', save }));
    const { controller } = fakeFrame();
    const { result, rerender, initial } = mount({ frame: controller });
    const oldCompletion = result.current.onSavePersisted;
    sessionStorage.setItem('ogm.away.other', JSON.stringify({ buildId: 'b1', save }));
    rerender({ ...initial, gameId: 'other', menuOpen: true });
    act(() => oldCompletion(save));
    rerender({ ...initial, gameId: 'other', menuOpen: false });
    expect(JSON.parse(sessionStorage.getItem('ogm.away.other')!)).toEqual({ buildId: 'b1', save });
  });

  it('does not clear a retained snapshot when an old write completes after unmount', () => {
    const save = { saveSchemaVersion: 1, data: 7 };
    sessionStorage.setItem('ogm.away.game', JSON.stringify({ buildId: 'b1', save }));
    const { controller } = fakeFrame();
    const { result, unmount } = mount({ frame: controller });
    const completion = result.current.onSavePersisted;
    unmount();
    act(() => completion(save));
    expect(JSON.parse(sessionStorage.getItem('ogm.away.game')!)).toEqual({ buildId: 'b1', save });
  });

  it('does not clear a newly recorded away marker when an unrelated save completes', () => {
    const save = { saveSchemaVersion: 1, data: 7 };
    const { controller, write } = fakeFrame();
    const { result } = mount({ frame: controller });
    act(() => write(save));
    sessionStorage.setItem('ogm.away.game', JSON.stringify({ buildId: '' }));
    act(() => result.current.onSavePersisted(save));
    expect(JSON.parse(sessionStorage.getItem('ogm.away.game')!)).toEqual({ buildId: '' });
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
    const { rerender, initial, openMenu } = mount({ frame: controller });
    expect(frame.restoreSave).not.toHaveBeenCalled();
    sessionStorage.setItem(
      'ogm.away.other',
      JSON.stringify({ buildId: 'b1', save: { saveSchemaVersion: 1, data: 2 } }),
    );
    rerender({ ...initial, frame: controller, gameId: 'other' });
    expect(openMenu).toHaveBeenCalledOnce();
  });

  it('keeps the restored save when the fresh game saves itself as the restore pauses it', () => {
    const save = { saveSchemaVersion: 1, data: { counter: 7 } };
    sessionStorage.setItem('ogm.away.game', JSON.stringify({ buildId: 'b1', save }));
    const { controller, write } = fakeFrame();
    mount({ frame: controller });
    // The SDK answers the pause with a save of the reloaded game's own state, which predates the restore.
    write({ saveSchemaVersion: 1, data: { counter: 0 }, reason: 'pause' });
    act(() => setVisibility('hidden'));
    expect(JSON.parse(sessionStorage.getItem('ogm.away.game')!)).toEqual({ buildId: 'b1', save });
  });
});
