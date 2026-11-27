import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RoomSessionSnapshot } from './session';
import { PAUSE_LIFT_WINDOW_MS, useMenuRoomPause } from './useMenuRoomPause';

type Props = { menuOpen: boolean; mode: 'play' | 'edit'; paused: boolean };

function setup(initial: Props) {
  const send = vi.fn();
  const session = { send } as unknown as NonNullable<Parameters<typeof useMenuRoomPause>[0]['room']['session']>;
  const snapshot = (paused: boolean): RoomSessionSnapshot =>
    ({
      status: 'connected',
      members: {},
      ...(paused ? { matchPause: { by: 'u1' } } : {}),
    }) as unknown as RoomSessionSnapshot;
  const hook = renderHook(
    ({ menuOpen, mode, paused }: Props) =>
      useMenuRoomPause({ menuOpen, mode, roomId: 'room-1', room: { session, snapshot: snapshot(paused) } }),
    { initialProps: initial },
  );
  return { send, rerender: hook.rerender };
}

const resumes = (send: ReturnType<typeof vi.fn>) =>
  send.mock.calls.filter(([message]) => (message as { t: string }).t === 'match.resume.request').length;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// The editor's menu only closes (#1326): unless it lifts the pause it asked for, every other player stays frozen.
describe('room pause from the game menu', () => {
  it('lifts the pause the editor menu asked for when the menu closes', () => {
    const { send, rerender } = setup({ menuOpen: true, mode: 'edit', paused: false });
    expect(send).toHaveBeenCalledWith({ t: 'match.pause.request' });
    rerender({ menuOpen: true, mode: 'edit', paused: true });
    rerender({ menuOpen: false, mode: 'edit', paused: true });
    expect(resumes(send)).toBe(1);
  });

  it('lifts a pause that lands just after a quick close', () => {
    const { send, rerender } = setup({ menuOpen: true, mode: 'edit', paused: false });
    rerender({ menuOpen: false, mode: 'edit', paused: false });
    expect(resumes(send)).toBe(0);
    vi.advanceTimersByTime(PAUSE_LIFT_WINDOW_MS - 1_000);
    rerender({ menuOpen: false, mode: 'edit', paused: true });
    expect(resumes(send)).toBe(1);
  });

  it("leaves a later pause alone: once the window passes, it is someone else's", () => {
    const { send, rerender } = setup({ menuOpen: true, mode: 'edit', paused: false });
    rerender({ menuOpen: false, mode: 'edit', paused: false });
    vi.advanceTimersByTime(PAUSE_LIFT_WINDOW_MS + 1_000);
    rerender({ menuOpen: false, mode: 'edit', paused: true });
    expect(resumes(send)).toBe(0);
  });

  it('asks again when reopened after a request that never landed', () => {
    const { send, rerender } = setup({ menuOpen: true, mode: 'edit', paused: false });
    rerender({ menuOpen: false, mode: 'edit', paused: false });
    vi.advanceTimersByTime(PAUSE_LIFT_WINDOW_MS + 1_000);
    rerender({ menuOpen: true, mode: 'edit', paused: false });
    expect(send.mock.calls.filter(([message]) => (message as { t: string }).t === 'match.pause.request')).toHaveLength(
      2,
    );
  });

  it("leaves the play panel's pause to its own Resume", () => {
    const { send, rerender } = setup({ menuOpen: true, mode: 'play', paused: true });
    rerender({ menuOpen: false, mode: 'play', paused: true });
    expect(resumes(send)).toBe(0);
  });
});
