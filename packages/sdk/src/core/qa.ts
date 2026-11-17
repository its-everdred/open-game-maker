import type { GameInstance, QaInvariant } from '@ogm/contracts/game';

declare global {
  interface Window {
    /** `gm qa playtest` reads the game's state checks here; `null` when the game implements none. */
    __gmQa?: { invariants(): QaInvariant[] | null };
  }
}

/**
 * Exposes the game's `qa.invariants()` in every build, published included, so a playtest of the live game can ask
 * whether its state is valid. It is read-only: nothing here can change the game.
 */
export function installQa(instance: Pick<GameInstance<unknown, unknown>, 'qa'>): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const qa = {
    invariants: (): QaInvariant[] | null => {
      if (!instance.qa) return null;
      try {
        return instance.qa.invariants().map(({ name, ok, detail }) => ({
          name: String(name),
          ok: ok === true,
          ...(detail === undefined ? {} : { detail: String(detail) }),
        }));
      } catch (error) {
        return [{ name: 'invariants ran', ok: false, detail: error instanceof Error ? error.message : String(error) }];
      }
    },
  };
  window.__gmQa = qa;
  return () => {
    if (window.__gmQa === qa) Reflect.deleteProperty(window, '__gmQa');
  };
}
