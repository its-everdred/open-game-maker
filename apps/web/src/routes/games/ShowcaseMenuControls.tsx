import { useMemo } from 'react';
import { useGameMenuControls } from '../../app/GameMenu';
import { pushToast } from '../../lib/notify';
import { playPath } from './CopyLink';
import type { GameSummary } from './types';

// Keep the real game's preference reachable without adding controls to the prototype detail sheet.
export function ShowcaseMenuControls({ game }: { game: GameSummary }) {
  const controls = useMemo(
    () => ({
      actions: [
        {
          id: 'copy-link',
          label: `Copy link to ${game.title}`,
          icon: 'link',
          onSelect: () => {
            void navigator.clipboard?.writeText(`${window.location.origin}${playPath(game)}`).then(
              () => pushToast('Link copied'),
              () => pushToast('Could not copy link'),
            );
          },
        },
      ],
      extras: [],
    }),
    [game],
  );
  useGameMenuControls(controls);
  return null;
}
