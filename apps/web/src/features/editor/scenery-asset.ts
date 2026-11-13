import type { GameManifest } from '@ogm/contracts/browser';

type Item = GameManifest['palette']['items'][number];
type Asset = { id: string; sha256: string; url: string };

/** Resolve only an asset explicitly named by the palette and locked by the selected branch. */
export function sceneryAsset(item: Item | undefined, assets: readonly Asset[] = []): Asset | undefined {
  if (!item?.prefab.startsWith('scenery:') || !item.assetSha) return undefined;
  const id = item.prefab.slice('scenery:'.length);
  return assets.find((asset) => asset.id === id && asset.sha256 === item.assetSha);
}
