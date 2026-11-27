import { useEffect, useRef } from 'react';

import type { RoomRuntime } from './useRoomRuntime';

/** How long the editor menu's room pause may still land after the menu closed and be lifted. */
export const PAUSE_LIFT_WINDOW_MS = 5_000;

/**
 * Opening the game menu in a room asks the match to pause. The play panel's Resume lifts the pause itself; the
 * editor's menu (#1326) only closes, so the pause it asked for is lifted here or the other players stay paused.
 */
export function useMenuRoomPause({
  menuOpen,
  mode,
  roomId,
  room,
}: {
  menuOpen: boolean;
  mode: 'play' | 'edit';
  roomId?: string;
  room: Pick<RoomRuntime, 'session' | 'snapshot'>;
}): void {
  const pauseRequested = useRef(false);
  const liftBy = useRef(0);
  useEffect(() => {
    if (!menuOpen) {
      if (pauseRequested.current && mode === 'edit') {
        /*
         * Closed before the pause landed: keep the request pending a few seconds and lift the pause when it arrives.
         * Past that, a pause is someone else's and stays.
         */
        liftBy.current ||= Date.now() + PAUSE_LIFT_WINDOW_MS;
        if (!room.snapshot?.matchPause && Date.now() < liftBy.current) return;
        if (room.snapshot?.matchPause && Date.now() < liftBy.current) {
          room.session?.send({ t: 'match.resume.request' });
        }
      }
      pauseRequested.current = false;
      liftBy.current = 0;
      return;
    }
    // Reopened after a request that never landed: ask again.
    if (liftBy.current !== 0 && Date.now() >= liftBy.current) pauseRequested.current = false;
    liftBy.current = 0;
    if (!pauseRequested.current && roomId !== undefined && room.session && room.snapshot?.status === 'connected') {
      room.session.send({ t: 'match.pause.request' });
      pauseRequested.current = true;
    }
  }, [menuOpen, mode, room.session, room.snapshot?.matchPause, room.snapshot?.status, roomId]);
}
