import type { GameManifest } from '@ogm/contracts/browser';

/** Resolve a game's palette images against the build that supplied its manifest. */
export function resolvePaletteThumbnails(
  manifest: GameManifest,
  gamesOrigin: string,
  gameId: string,
  buildId: string,
  preview: boolean,
  draftGrant?: string,
): GameManifest {
  const base = new URL(
    draftGrant && !preview
      ? `/d/${encodeURIComponent(gameId)}/${encodeURIComponent(buildId)}/${encodeURIComponent(draftGrant)}/index.html`
      : `/${preview ? 'p' : 'g'}/${encodeURIComponent(gameId)}/${encodeURIComponent(buildId)}/index.html`,
    gamesOrigin,
  );
  return {
    ...manifest,
    palette: {
      ...manifest.palette,
      items: manifest.palette.items.map((item) => {
        if (!item.thumbnail) return item;
        try {
          const thumbnail =
            draftGrant && !preview && /^\/a\/[0a-f]{64}\.[a-z0-9]{1,12}$/u.test(item.thumbnail)
              ? `a/${item.thumbnail.slice(3)}`
              : item.thumbnail;
          return { ...item, thumbnail: new URL(thumbnail, base).href };
        } catch {
          return item;
        }
      }),
    },
  };
}
