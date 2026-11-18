import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { CommandsInbox } from '../../features/commands-inbox/CommandsInbox';
import { openConversation } from '../../features/build-chat/conversation';
import { Icon } from '../../components/Icon';
import { Cover } from './Cover';
import { Ambient } from './Ambient';
import { GameTrailer } from './GameTrailer';
import { splatMask } from './splatMask';
import showcaseRecords from './showcase-data.json';
import { gameTags, genreIcon, type GameSummary, type JobView } from './types';
import { jobLabel } from './Tile';

// Every game's trailer sits in Goblin Cellar's splatter frame.
const FRAME_SEED = 'goblin-cellar';

type DetailTag = { key: string; label: string; color: string };
type DetailStats = { played?: string; rating?: number; version?: string; plays?: string };

const curatedColors = new Map(
  showcaseRecords.flatMap((record) => record.displayTags.map((tag) => [tag.key, tag.color] as const)),
);

function tagColor(key: string): string {
  const known = curatedColors.get(key);
  if (known) return known;
  const hue = [...key].reduce((value, character) => (value * 31 + character.charCodeAt(0)) % 330, 7);
  return `hsl(${hue} 72% 66%)`;
}

function formatCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${Number((value / 1000).toFixed(1))}k`;
  return `${Number((value / 1_000_000).toFixed(1))}M`;
}

/** The detail view shows the same rows for every game; only where the data comes from differs. */
export function detailOf(game: GameSummary): { description?: string; tags: DetailTag[]; stats: DetailStats } {
  const curated = game.showcase;
  if (curated) {
    return {
      description: curated.tagline,
      tags: curated.displayTags.map(({ key, label, color }) => ({ key, label, color })),
      stats: {
        played: curated.played || undefined,
        rating: curated.rating ?? undefined,
        version: curated.version || undefined,
        plays: curated.plays || undefined,
      },
    };
  }
  return {
    description: game.tagline,
    tags: gameTags(game).map((name) => {
      const key = genreIcon(name);
      const label = name === name.toLowerCase() ? name.charAt(0).toUpperCase() + name.slice(1) : name;
      return { key, label, color: tagColor(key) };
    }),
    stats: {
      version: game.stats?.version,
      plays: game.stats?.plays === undefined ? undefined : formatCount(game.stats.plays),
    },
  };
}

export function GameDetail({
  game,
  job,
  canOpen,
  onPlay,
  onEdit,
  onClose,
  sharedCover,
}: {
  game: GameSummary;
  job?: JobView;
  sharedCover?: boolean;
  canOpen: boolean;
  onPlay(): void;
  onEdit(): void;
  onClose(): void;
}) {
  const close = useRef<HTMLButtonElement>(null);
  const starId = useId();
  const [mask, setMask] = useState<string>();
  const { description, tags, stats } = detailOf(game);
  const hasStats = Object.values(stats).some((value) => value !== undefined);
  useEffect(() => close.current?.focus(), [game.id]);
  useEffect(() => {
    let active = true;
    void splatMask(FRAME_SEED).then((value) => {
      if (active) setMask(value);
    });
    return () => {
      active = false;
    };
  }, []);
  return (
    <section
      className="games-spotlight"
      aria-live="polite"
      aria-label={`${game.title} spotlight`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <Ambient game={game} />
      <button ref={close} type="button" className="games-close" aria-label="Close game" onClick={onClose}>
        <Icon name="close" />
      </button>
      <div className="games-spotlight-copy">
        <h1>{game.title}</h1>
        {description && <p className="games-tagline">{description}</p>}
        {job && <p className="games-spotlight-job">{jobLabel(job)}</p>}
        {!game.id.startsWith('showcase:') && (
          <CommandsInbox gameId={game.id} slug={game.slug} onOpenJob={openConversation} />
        )}
        {tags.length > 0 && (
          <ul className="games-detail-tags" aria-label="Tags">
            {tags.map((tag, index) => (
              <li key={`${tag.key}:${index}`} style={{ '--tag-color': tag.color } as CSSProperties}>
                <span>
                  <Icon name={tag.key} />
                </span>
                {tag.label}
              </li>
            ))}
          </ul>
        )}
        {hasStats && (
          <dl className="games-detail-stats">
            {stats.played && (
              <div>
                <dt>Time played</dt>
                <dd>{stats.played}</dd>
              </div>
            )}
            {stats.rating !== undefined && (
              <div>
                <dt>Rating</dt>
                <dd className="games-detail-stars" aria-label={`${stats.rating} out of 5`}>
                  {Array.from({ length: 5 }, (_, index) => {
                    const fill = Math.max(0, Math.min(1, stats.rating! - index)) * 100;
                    const id = `${starId}-${index}`;
                    return (
                      <svg key={id} viewBox="0 0 24 24" aria-hidden="true">
                        <defs>
                          <linearGradient id={id}>
                            <stop offset={`${fill}%`} stopColor="var(--yellow-b)" />
                            <stop offset={`${fill}%`} stopColor="var(--rating-empty)" />
                          </linearGradient>
                        </defs>
                        <path
                          d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z"
                          fill={`url(#${id})`}
                        />
                      </svg>
                    );
                  })}
                  <small>{stats.rating}</small>
                </dd>
              </div>
            )}
            {stats.version && (
              <div>
                <dt>Version</dt>
                <dd>v{stats.version}</dd>
              </div>
            )}
            {stats.plays && (
              <div>
                <dt>Plays</dt>
                <dd>{stats.plays}</dd>
              </div>
            )}
          </dl>
        )}
        <div className="games-spotlight-actions">
          <button
            type="button"
            className="tap-primary games-play"
            disabled={!canOpen}
            aria-label={`Play ${game.title}`}
            onClick={onPlay}
          >
            ▶
          </button>
          <button
            type="button"
            className="tap-primary games-edit"
            disabled={!canOpen}
            aria-label={`Edit ${game.title}`}
            onClick={onEdit}
          >
            ✎
          </button>
        </div>
      </div>
      <div
        className="games-spotlight-media"
        data-splat={Boolean(mask)}
        style={mask ? { maskImage: `url(${mask})`, WebkitMaskImage: `url(${mask})` } : undefined}
      >
        <span className="game-cover">
          {sharedCover ? (
            <span data-cover-slot />
          ) : game.trailerUrl ? (
            <GameTrailer game={game} />
          ) : (
            <Cover game={game} hero />
          )}
        </span>
      </div>
    </section>
  );
}
