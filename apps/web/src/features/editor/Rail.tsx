import type { GameManifest } from '@ogm/contracts/browser';

import { FocusZone } from '../../lib/input';
import { EDITOR_FOCUS_ZONES } from './focus';
import { SceneryThumbnail } from './SceneryThumbnail';
import { TerrainThumbnail } from './TerrainThumbnail';
import { sceneryAsset } from './scenery-asset';

type Category = GameManifest['palette']['categories'][number];
type Item = GameManifest['palette']['items'][number];

export function Rail({
  categories,
  items = [],
  sceneryAssets = [],
  buildPinnedAssets = false,
  active,
  onChange,
}: {
  categories: Category[];
  items?: Item[];
  sceneryAssets?: readonly { id: string; sha256: string; url: string }[];
  buildPinnedAssets?: boolean;
  active?: string;
  onChange(id: string): void;
}) {
  return (
    <FocusZone id={EDITOR_FOCUS_ZONES.rail} className="editor-rail">
      {categories.map((category) => {
        const item = items.find(
          (candidate) =>
            candidate.category === category.id &&
            (candidate.thumbnail ||
              sceneryAsset(candidate, sceneryAssets, buildPinnedAssets) ||
              candidate.prefab.startsWith('scenery-band:')),
        );
        const thumbnail = item?.thumbnail;
        const asset = sceneryAsset(item, sceneryAssets, buildPinnedAssets);
        return (
          <button
            className="tap-secondary"
            type="button"
            key={category.id}
            aria-pressed={category.id === active}
            aria-label={category.label}
            onClick={() => onChange(category.id)}
          >
            {thumbnail ? (
              <img src={thumbnail} alt="" />
            ) : asset ? (
              <SceneryThumbnail url={asset.url} />
            ) : item ? (
              <TerrainThumbnail prefab={item.prefab} />
            ) : null}
            <span>{category.label}</span>
          </button>
        );
      })}
    </FocusZone>
  );
}
