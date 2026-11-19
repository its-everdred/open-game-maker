import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

import type { SaveData } from '@ogm/contracts/browser';

import type { GameFrameController } from '../../features/editor/frame';

/** How often play checks for a lost focus it gets no event for: the iOS app switcher while the game frame has focus. */
export const FOCUS_POLL_MS = 500;

export type AwaySnapshot = { buildId: string; save?: SaveData<unknown> };

const storageKey = (gameId: string) => `ogm.away.${gameId}`;

/** Track a background transition before the asynchronous game frame is mounted. */
export function useEarlyAwayHold(
  active: boolean,
  gameId: string,
  hold: { current: boolean },
  openMenu: () => void,
): void {
  const openRef = useRef(openMenu);
  openRef.current = openMenu;
  useLayoutEffect(() => {
    if (!active) return;
    const onVisibility = () => {
      if (document.visibilityState !== 'hidden') return;
      hold.current = true;
      openRef.current();
    };
    const onPageHide = () => {
      hold.current = true;
      openRef.current();
      if (!gameId) return;
      try {
        if (sessionStorage.getItem(storageKey(gameId)) === null) writeAway(gameId, { buildId: '' });
      } catch {
        // Storage is optional; the in-memory hold still applies.
      }
    };
    let hadFocus = document.hasFocus();
    const checkFocus = () => {
      const focused = document.hasFocus();
      if (hadFocus && !focused) {
        hold.current = true;
        openRef.current();
      }
      hadFocus = focused;
    };
    let blurCheck: ReturnType<typeof setTimeout> | undefined;
    const onBlur = () => {
      clearTimeout(blurCheck);
      blurCheck = setTimeout(checkFocus, 0);
    };
    const poll = setInterval(checkFocus, FOCUS_POLL_MS);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('blur', onBlur);
    onVisibility();
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('blur', onBlur);
      clearTimeout(blurCheck);
      clearInterval(poll);
    };
  }, [active, gameId, hold]);
}

export function readAway(gameId: string, buildId: string): AwaySnapshot | undefined {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(storageKey(gameId)) ?? 'null');
    if (typeof value !== 'object' || value === null) return undefined;
    const snapshot = value as Partial<AwaySnapshot>;
    // A save from another build may not restore; the player then starts this build paused instead.
    if (snapshot.buildId !== buildId) return { buildId };
    return { buildId, ...(snapshot.save ? { save: snapshot.save } : {}) };
  } catch {
    return undefined;
  }
}

function writeAway(gameId: string, snapshot: AwaySnapshot): void {
  try {
    sessionStorage.setItem(storageKey(gameId), JSON.stringify(snapshot));
  } catch {
    // A full or blocked store still pauses; only the reload restore is lost.
  }
}

function clearAway(gameId: string): void {
  try {
    sessionStorage.removeItem(storageKey(gameId));
  } catch {
    // Nothing was stored.
  }
}

type AwayPauseOptions = {
  /** The running play frame; undefined while editing or before the game is ready. */
  frame: GameFrameController | undefined;
  gameId: string;
  buildId: string | undefined;
  /** Solo play keeps a snapshot for a reload; a room restores from the room instead. */
  solo: boolean;
  menuOpen: boolean;
  captureSaves?: boolean;
  openMenu(): void;
  releaseHold?(): void;
};

/**
 * Leaving play (the page hidden, unloaded, or the window losing focus) opens the pause menu exactly like the Menu
 * button, so the game stays paused on return until the player resumes. Solo play also keeps the game's latest
 * save in the tab's session store, so a tab the browser evicted in the background reloads to the same paused state.
 */
export function useAwayPause({
  frame,
  gameId,
  buildId,
  solo,
  menuOpen,
  openMenu,
  releaseHold,
  captureSaves = true,
}: AwayPauseOptions): { onSavePersisted(save: SaveData<unknown>, restored?: boolean): void; resetAway(): void } {
  const away = useRef(false);
  /** The game and build already checked for a snapshot, so a re-render does not restore twice. */
  const restoredFor = useRef<string | undefined>(undefined);
  /**
   * The restored save is the game's state until the player resumes: the save the fresh game writes as it pauses
   * predates the restore, so saves are ignored until then and leaving again keeps the restored one.
   */
  const restoredSave = useRef<SaveData<unknown> | undefined>(undefined);
  const latestSave = useRef<SaveData<unknown> | undefined>(undefined);
  const awaitingPersistence = useRef(false);
  const wasOpen = useRef(menuOpen);
  const openMenuRef = useRef(openMenu);
  openMenuRef.current = openMenu;
  const active = useRef<
    { gameId: string; buildId: string | undefined; frame: GameFrameController | undefined } | undefined
  >(undefined);
  useLayoutEffect(() => {
    active.current = { gameId, buildId, frame };
    return () => {
      active.current = undefined;
    };
  }, [gameId, buildId, frame]);

  useEffect(() => {
    const key = `${gameId}\n${buildId}`;
    if (!frame || buildId === undefined || !solo || restoredFor.current === key) return;
    restoredFor.current = key;
    const snapshot = readAway(gameId, buildId);
    restoredSave.current = snapshot?.save;
    latestSave.current = snapshot?.save;
    awaitingPersistence.current = Boolean(snapshot?.save);
    if (!snapshot) return;
    away.current = true;
    frame.pause();
    openMenuRef.current();
  }, [buildId, frame, gameId, solo]);

  useEffect(() => {
    if (wasOpen.current && !menuOpen) {
      away.current = false;
      releaseHold?.();
      restoredSave.current = undefined;
      if (!awaitingPersistence.current) clearAway(gameId);
    }
    wasOpen.current = menuOpen;
  }, [gameId, menuOpen, releaseHold]);

  useEffect(() => {
    if (!frame || buildId === undefined || !captureSaves) return;
    const observe = frame.observeSaveWrite ?? frame.onSaveWrite;
    return observe(({ saveSchemaVersion, data }) => {
      if (restoredSave.current) return;
      latestSave.current = { saveSchemaVersion, data };
      if ((away.current || awaitingPersistence.current) && solo)
        writeAway(gameId, { buildId, save: latestSave.current });
    });
  }, [buildId, captureSaves, frame, gameId, solo]);

  useEffect(() => {
    if (!frame || buildId === undefined) return;
    const keep = () => {
      if (solo) writeAway(gameId, { buildId, ...(latestSave.current ? { save: latestSave.current } : {}) });
    };
    const leave = () => {
      away.current = true;
      keep();
      openMenuRef.current();
    };
    let hadFocus = document.hasFocus();
    const checkFocus = () => {
      const focused = document.hasFocus();
      // Only a change counts: a page that opened without focus (a background tab, a preview) is not leaving.
      if (hadFocus && !focused) leave();
      hadFocus = focused;
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') leave();
    };
    if (document.visibilityState === 'hidden') leave();
    // A blur also fires when focus moves into the game frame; the deferred check tells the two apart.
    let blurCheck: ReturnType<typeof setTimeout> | undefined;
    const onBlur = () => {
      blurCheck = setTimeout(checkFocus, 0);
    };
    const poll = setInterval(checkFocus, FOCUS_POLL_MS);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', leave);
    window.addEventListener('blur', onBlur);
    return () => {
      clearTimeout(blurCheck);
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('blur', onBlur);
      // Play ended inside the app (edit mode, another screen): a later visit starts fresh. A reload never gets here.
      if (away.current) {
        away.current = false;
        releaseHold?.();
        if (!awaitingPersistence.current) clearAway(gameId);
      }
    };
  }, [buildId, frame, gameId, solo]);
  const onSavePersisted = useCallback(
    (save: SaveData<unknown>, restored = false) => {
      if (
        !active.current ||
        active.current.gameId !== gameId ||
        active.current.buildId !== buildId ||
        active.current.frame !== frame
      )
        return;
      if (!awaitingPersistence.current && !restored) return;
      const current = { saveSchemaVersion: save.saveSchemaVersion, data: save.data };
      if (restored) {
        latestSave.current = current;
        if (away.current && solo && buildId !== undefined) writeAway(gameId, { buildId, save: current });
      } else if (JSON.stringify(current) !== JSON.stringify(latestSave.current)) {
        return;
      }
      awaitingPersistence.current = false;
      if (!away.current) clearAway(gameId);
    },
    [buildId, frame, gameId, solo],
  );
  const resetAway = useCallback(() => {
    away.current = false;
    restoredSave.current = undefined;
    latestSave.current = undefined;
    awaitingPersistence.current = false;
    clearAway(gameId);
  }, [gameId]);
  return { onSavePersisted, resetAway };
}
