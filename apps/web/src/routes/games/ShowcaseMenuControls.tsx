import { useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useGameMenuControls } from '../../app/GameMenu';
import { api } from '../../lib/api/client';
import { pushToast } from '../../lib/notify';
import { playPath } from './CopyLink';
import type { GameSummary } from './types';

// Keep the real game's preference reachable without adding controls to the prototype detail sheet.
export function ShowcaseMenuControls({ game }: { game: GameSummary }) {
  const client = useQueryClient();
  const preference = useMutation({
    mutationFn: (allow: boolean) =>
      api(`/games/${encodeURIComponent(game.id)}`, { method: 'PATCH', json: { allowAiGeneratedAssets: allow } }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['games'] }),
  });
  const allowed = game.allowAiGeneratedAssets ?? true;
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
        {
          id: 'ai-assets',
          label: allowed ? 'Disable AI-generated assets' : 'Enable AI-generated assets',
          icon: 'other',
          disabled: preference.isPending,
          onSelect: () => preference.mutate(!allowed),
        },
      ],
      extras: [],
    }),
    [allowed, game, preference.isPending, preference.mutate],
  );
  useGameMenuControls(controls);
  return null;
}
