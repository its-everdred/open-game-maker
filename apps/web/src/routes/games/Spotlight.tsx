import { useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../../lib/api/client';
import { CommandsInbox } from '../../features/commands-inbox/CommandsInbox';
import { openConversation } from '../../features/build-chat/conversation';
import type { Branch } from './types';
import { Cover } from './Cover';
import { gameTags, type GameSummary, type JobView } from './types';
import { jobLabel } from './Tile';

type SpotlightProps = {
  game: GameSummary;
  branches: Branch[];
  job?: JobView;
  onPlay(branchId: string): void;
  onEdit(branchId: string): void;
  onClose(): void;
};

export function Spotlight({ game, branches, job, onPlay, onEdit, onClose }: SpotlightProps) {
  const queryClient = useQueryClient();
  const preference = useMutation({
    mutationFn: (allowAiGeneratedAssets: boolean) =>
      api(`/games/${encodeURIComponent(game.id)}`, {
        method: 'PATCH',
        json: { allowAiGeneratedAssets },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['games'] }),
  });
  const closeRef = useRef<HTMLButtonElement>(null);
  const activeBranch = branches.find((branch) => branch.name === 'main') ?? branches[0];
  const canOpen = Boolean(activeBranch?.latestBuildId) && job?.kind !== 'new_game';
  const tags = gameTags(game);

  useEffect(() => closeRef.current?.focus(), [game.id]);

  return (
    <section
      className="games-spotlight"
      aria-live="polite"
      aria-label={`${game.title} spotlight`}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        onClose();
      }}
    >
      <button ref={closeRef} type="button" className="games-close" aria-label="Close game" onClick={onClose}>
        <span aria-hidden="true">×</span>
      </button>
      <div className="games-spotlight-copy">
        <h1>{game.title}</h1>
        {game.tagline && <p className="games-tagline">{game.tagline}</p>}
        {tags.length > 0 && (
          <ul className="games-tags" aria-label="Tags">
            {tags.map((tag) => (
              <li key={tag}>{tag}</li>
            ))}
          </ul>
        )}
        {job && <p className="games-spotlight-job">{jobLabel(job)}</p>}
        <CommandsInbox gameId={game.id} slug={game.slug} onOpenJob={openConversation} />
        <label className="games-ai-switch">
          <input
            type="checkbox"
            role="switch"
            checked={game.allowAiGeneratedAssets ?? true}
            disabled={preference.isPending}
            onChange={(event) => preference.mutate(event.currentTarget.checked)}
          />
          AI-generated assets
        </label>
        <div className="games-versions">
          <ul aria-label="Versions">
            {branches.map((branch) => (
              <li
                key={branch.id}
                aria-label={branch.name}
                aria-current={branch.id === activeBranch?.id ? 'true' : undefined}
              >
                {branch.name}
              </li>
            ))}
          </ul>
        </div>
        <div className="games-spotlight-actions">
          <button
            type="button"
            className="tap-primary games-play"
            disabled={!canOpen}
            aria-label={`Play ${game.title}`}
            onClick={() => activeBranch && onPlay(activeBranch.id)}
          >
            Play
          </button>
          <button
            type="button"
            className="tap-primary games-edit"
            disabled={!canOpen}
            aria-label={`Edit ${game.title}`}
            onClick={() => activeBranch && onEdit(activeBranch.id)}
          >
            Edit
          </button>
        </div>
      </div>
      <div className="games-spotlight-media" aria-hidden="true">
        <span className="game-cover">
          <Cover game={game} />
        </span>
      </div>
    </section>
  );
}
