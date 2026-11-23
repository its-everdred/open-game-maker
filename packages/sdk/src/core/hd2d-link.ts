/** What the running HD-2D renders: its scene document and the biome and weather it renders in. */
export interface Hd2dState {
  doc: unknown;
  biome?: string;
  weather?: string;
}

/**
 * A running HD-2D as the editor reaches it over the bridge (`hd2d.scene`, `hd2d.apply`). `createHd2d` links itself,
 * so a game that uses the facade is editable live with no code of its own.
 */
export interface Hd2dLink {
  state(): Hd2dState;
  /** Re-renders from an edited document (throws on an invalid one); `weather` previews it in that weather. */
  apply(doc: unknown, weather?: string): void;
}

let linked: Hd2dLink | undefined;
const watchers = new Set<() => void>();
const notify = () => {
  for (const watcher of watchers) watcher();
};

/** The newest link wins: a scene that starts before the last one shut down takes over the editor at once. */
export function linkHd2d(link: Hd2dLink): { changed(): void; unlink(): void } {
  linked = link;
  notify();
  return {
    changed() {
      if (linked === link) notify();
    },
    unlink() {
      if (linked !== link) return;
      linked = undefined;
      notify();
    },
  };
}

export function linkedHd2d(): Hd2dLink | undefined {
  return linked;
}

/** Calls `watcher` whenever the linked HD-2D, its document or its weather changes. */
export function watchHd2d(watcher: () => void): () => void {
  watchers.add(watcher);
  return () => watchers.delete(watcher);
}
