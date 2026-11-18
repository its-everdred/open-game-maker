import { useEffect, useRef } from 'react';

import type { SaveData } from '@ogm/contracts/browser';

import type { GameFrameController } from '../../features/editor/frame';

/** How often play checks for a lost focus it gets no event for: the iOS app switcher while the game frame has focus. */
export const FOCUS_POLL_MS = 500;

type AwaySnapshot = { buildId: string; save?: SaveData<unknown> };

const storageKey = (gameId: string) => `ogm.away.${gameId}`;

function readAway(gameId: string, buildId: string): AwaySnapshot | undefined {
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
  openMenu(): void;
};

/**
 * Leaving play (the page hidden, unloaded, or the window losing focus) opens the pause menu exactly like the Menu
 * button, so the game stays paused on return until the player resumes (#874). Solo play also keeps the game's latest
 * save in the tab's session store, so a tab the browser evicted in the background reloads to the same paused state.
 */
export function useAwayPause({ frame, gameId, buildId, solo, menuOpen, openMenu }: AwayPauseOptions): void {
  const away = useRef(false);
  const restored = useRef(false);
  const wasOpen = useRef(menuOpen);
  const openMenuRef = useRef(openMenu);
  openMenuRef.current = openMenu;

  useEffect(() => {
    if (!frame || buildId === undefined || !solo || restored.current) return;
    restored.current = true;
    const snapshot = readAway(gameId, buildId);
    if (!snapshot) return;
    away.current = true;
    frame.pause();
    if (snapshot.save) frame.restoreSave(snapshot.save);
    openMenuRef.current();
  }, [buildId, frame, gameId, solo]);

  useEffect(() => {
    if (wasOpen.current && !menuOpen) {
      away.current = false;
      clearAway(gameId);
    }
    wasOpen.current = menuOpen;
  }, [gameId, menuOpen]);

  useEffect(() => {
    if (!frame || buildId === undefined) return;
    let latest: SaveData<unknown> | undefined;
    const keep = () => {
      if (solo) writeAway(gameId, { buildId, ...(latest ? { save: latest } : {}) });
    };
    const stopSave = frame.onSaveWrite(({ saveSchemaVersion, data }) => {
      latest = { saveSchemaVersion, data };
      if (away.current) keep();
    });
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
    // A blur also fires when focus moves into the game frame; the deferred check tells the two apart.
    const onBlur = () => setTimeout(checkFocus, 0);
    const poll = setInterval(checkFocus, FOCUS_POLL_MS);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', leave);
    window.addEventListener('blur', onBlur);
    return () => {
      stopSave();
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('blur', onBlur);
    };
  }, [buildId, frame, gameId, solo]);
}
