import type { GameManifest } from '@ogm/contracts/browser';

/** Resolve a game's palette images against the build that supplied its manifest. */
export function resolvePaletteThumbnails(
  manifest: GameManifest,
  gamesOrigin: string,
  gameId: string,
  buildId: string,
  preview: boolean,
): GameManifest {
  const base = new URL(
    `/${preview ? 'p' : 'g'}/${encodeURIComponent(gameId)}/${encodeURIComponent(buildId)}/index.html`,
    gamesOrigin,
  );
  return {
    ...manifest,
    palette: {
      ...manifest.palette,
      items: manifest.palette.items.map((item) => {
        if (!item.thumbnail) return item;
        try {
          return { ...item, thumbnail: new URL(item.thumbnail, base).href };
        } catch {
          return item;
        }
      }),
    },
  };
}
