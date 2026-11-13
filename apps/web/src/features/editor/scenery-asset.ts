import type { GameManifest } from '@ogm/contracts/browser';

type Item = GameManifest['palette']['items'][number];
type Asset = { id: string; sha256: string; url: string };

/** Resolve only an asset named by the palette whose locked hash matches. */
export function sceneryAsset(
  item: Item | undefined,
  assets: readonly Asset[] = [],
  buildPinned = false,
): Asset | undefined {
  if (!item) return undefined;
  const id =
    typeof item.assetId === 'string'
      ? item.assetId
      : item.prefab.startsWith('scenery:')
        ? item.prefab.slice('scenery:'.length)
        : undefined;
  if (!id) return undefined;
  if (typeof item.assetSha !== 'string' && !(buildPinned && item.prefab.startsWith('scenery:'))) return undefined;
  return assets.find(
    (asset) => asset.id === id && (typeof item.assetSha !== 'string' || asset.sha256 === item.assetSha),
  );
}
