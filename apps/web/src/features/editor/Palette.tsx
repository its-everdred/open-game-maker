import { useEffect, useState } from 'react';

import type { GameManifest } from '@ogm/contracts/browser';

import { AiBadge, withAiGeneratedLabel } from '../../components/AiBadge';
import { FocusZone } from '../../lib/input';
import { EDITOR_FOCUS_ZONES } from './focus';
import { SceneryThumbnail } from './SceneryThumbnail';

type PaletteProps = {
  palette: GameManifest['palette'];
  category?: string;
  title?: string;
  showTabs?: boolean;
  onCategory?(id: string): void;
  onPick(prefab: string): void;
  sceneryAssets?: readonly { id: string; sha256: string; url: string }[];
};

export function Palette({
  palette,
  category,
  title,
  showTabs = true,
  onCategory,
  onPick,
  sceneryAssets,
}: PaletteProps) {
  const [localCategory, setLocalCategory] = useState(palette.categories[0]?.id ?? '');
  const active = category ?? localCategory;
  useEffect(() => {
    if (!palette.categories.some((candidate) => candidate.id === active)) {
      setLocalCategory(palette.categories[0]?.id ?? '');
    }
  }, [active, palette.categories]);
  const chooseCategory = (id: string) => {
    setLocalCategory(id);
    onCategory?.(id);
  };

  return (
    <FocusZone id={EDITOR_FOCUS_ZONES.palette} className="editor-palette">
      {title ? <h2>{title}</h2> : null}
      {showTabs ? (
        <div className="palette-tabs" role="tablist" aria-label="Palette">
          {palette.categories.map((candidate) => (
            <button
              className="tap-secondary"
              type="button"
              role="tab"
              key={candidate.id}
              aria-selected={candidate.id === active}
              onClick={() => chooseCategory(candidate.id)}
            >
              {candidate.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="palette-items">
        {palette.items
          .filter((item) => item.category === active)
          .map((item) => {
            const asset =
              typeof item.assetSha === 'string' && item.prefab.startsWith('scenery:')
                ? sceneryAssets?.find(
                    (candidate) =>
                      candidate.id === item.prefab.slice('scenery:'.length) && candidate.sha256 === item.assetSha,
                  )
                : undefined;
            return (
              <button
                className="palette-item tap-primary"
                type="button"
                key={item.prefab}
                aria-label={withAiGeneratedLabel(item.label, item.aiGenerated)}
                title={item.hint}
                onPointerDown={() => onPick(item.prefab)}
                onClick={(event) => {
                  if (event.detail === 0) onPick(item.prefab);
                }}
              >
                {item.thumbnail ? (
                  <img src={item.thumbnail} alt="" />
                ) : asset && /\.(png|jpe?g|webp)(?:\?|$)/i.test(asset.url) ? (
                  <img src={asset.url} alt="" />
                ) : asset ? (
                  <SceneryThumbnail key={asset.url} url={asset.url} />
                ) : null}
                {item.aiGenerated ? <AiBadge /> : null}
                <span>{item.label}</span>
              </button>
            );
          })}
      </div>
    </FocusZone>
  );
}
