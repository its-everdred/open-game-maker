import { useEffect, useRef } from 'react';

import { CommandsInbox } from '../../features/commands-inbox/CommandsInbox';
import { openConversation } from '../../features/build-chat/conversation';
import type { Branch } from './types';
import { Icon } from '../../components/Icon';
import { Cover } from './Cover';
import { Ambient } from './Ambient';
import { GameTrailer } from './GameTrailer';
import { gameGenres, genreIcon, type GameSummary, type JobView } from './types';
import { jobLabel } from './Tile';

type SpotlightProps = {
  game: GameSummary;
  sharedCover?: boolean;
  branches: Branch[];
  job?: JobView;
  onPlay(branchId: string): void;
  onEdit(branchId: string): void;
  onClose(): void;
};

export function Spotlight({ game, branches, job, onPlay, onEdit, onClose, sharedCover }: SpotlightProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const activeBranch = branches.find((branch) => branch.name === 'main') ?? branches[0];
  const canOpen = Boolean(activeBranch?.latestBuildId) && job?.kind !== 'new_game';
  const tags = gameGenres(game);

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
      <Ambient game={game} />
      <button ref={closeRef} type="button" className="games-close" aria-label="Close game" onClick={onClose}>
        <span aria-hidden="true">×</span>
      </button>
      <div className="games-spotlight-copy">
        {!game.logoUrl && <h1>{game.title}</h1>}
        {game.tagline && <p className="games-tagline">{game.tagline}</p>}
        {job && <p className="games-spotlight-job">{jobLabel(job)}</p>}
        <CommandsInbox gameId={game.id} slug={game.slug} onOpenJob={openConversation} />
        {tags.length > 0 && (
          <span className="game-tag-icons spotlight-icons" aria-label={tags.join(', ')}>
            {tags.slice(0, 4).map((tag) => (
              <Icon key={tag} name={genreIcon(tag)} />
            ))}
          </span>
        )}
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
      <div className="games-spotlight-media">
        <span className="game-cover">
          {sharedCover ? (
            <span data-cover-slot />
          ) : game.trailerUrl ? (
            <GameTrailer game={game} />
          ) : (
            <Cover game={game} />
          )}
          {game.logoUrl && <img className="game-logo" src={game.logoUrl} alt="" />}
        </span>
      </div>
    </section>
  );
}
