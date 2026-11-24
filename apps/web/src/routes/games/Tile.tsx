import { DisplayImage } from './DisplayImage';
import type { CSSProperties } from 'react';
import records from './showcase-data.json';
import { Icon } from '../../components/Icon';
import { Cover } from './Cover';
import { gameGenres, genreIcon, type GameSummary, type JobView } from './types';

const colors = new Map(records.flatMap((record) => record.displayTags.map((tag) => [tag.key, tag.color] as const)));
const playerTags = new Set([
  'solo',
  'multiplayer',
  ...records.flatMap((record) =>
    record.displayTags.filter((tag) => tag.kind === 'players').flatMap((tag) => [tag.key, tag.label.toLowerCase()]),
  ),
]);

type TileProps = {
  game: GameSummary;
  sharedCover?: boolean;
  /** On the first screen: its art loads first. */
  eager?: boolean;
  job?: JobView;
  selected: boolean;
  tabIndex: number;
  onClick(): void;
  onFocus(): void;
};

export function Tile({ game, job, selected, tabIndex, onClick, onFocus, sharedCover, eager }: TileProps) {
  const unavailable = game.creationStatus === 'creating' || game.creationStatus === 'failed';
  const statusLabel = game.creationStatus === 'creating' ? 'Creating' : 'Setup failed';
  const accessibleName = unavailable
    ? `${game.title}: ${statusLabel}`
    : game.tagline
      ? `${game.title}: ${game.tagline}`
      : game.title;
  if (game.showcase) {
    const tags = game.showcase.displayTags.filter((tag) => tag.kind === 'genre' || tag.kind === 'vibe').slice(0, 4);
    return (
      <button
        type="button"
        className="game-tile showcase-tile"
        aria-label={unavailable ? accessibleName : `${game.title}: ${game.showcase.tagline}`}
        aria-pressed={selected}
        disabled={unavailable}
        tabIndex={tabIndex}
        onClick={onClick}
        onFocus={onFocus}
      >
        <span className="game-cover">
          {sharedCover ? <span data-cover-slot /> : <Cover game={game} eager={eager} />}
          {job && <span className="game-building-chip">{jobLabel(job)}</span>}
          {unavailable && (
            <span className="game-building-chip">
              {game.creationStatus === 'creating' ? 'Creating…' : 'Setup failed'}
            </span>
          )}
          {game.showcase.badge && <span className="game-new-badge">{game.showcase.badge}</span>}
          {game.logoUrl && (
            <DisplayImage
              className="game-logo"
              src={game.logoUrl}
              image={game.logoImage}
              sizes="(max-width: 600px) 80vw, 560px"
              priority={eager}
              keepShown
            />
          )}
          <span className="game-tile-meta">
            {!game.logoUrl && (
              <strong style={{ fontFamily: `'${game.showcase.font}', var(--display)`, color: game.showcase.color }}>
                {game.title}
              </strong>
            )}
            <span className="showcase-tile-row">
              <span className="game-tag-icons" aria-label={tags.map((tag) => tag.label).join(', ')}>
                {tags.map((tag) => (
                  <span key={tag.key} style={{ '--tag-color': tag.color } as CSSProperties}>
                    <Icon name={tag.key} />
                  </span>
                ))}
              </span>
              <span className="showcase-rating">{game.showcase.rating ? `★ ${game.showcase.rating}` : 'New'}</span>
            </span>
          </span>
        </span>
      </button>
    );
  }
  const publishedTags = (game.tags ?? []).filter((tag) => !playerTags.has(tag.trim().toLowerCase()));
  const tags = [
    ...new Map(
      [...gameGenres(game), ...(game.choices?.vibe ?? []), ...publishedTags].map((tag) => [
        tag.trim().toLowerCase(),
        tag,
      ]),
    ).values(),
  ].slice(0, 4);
  const label = accessibleName;

  return (
    <button
      type="button"
      className="game-tile"
      aria-label={label}
      aria-pressed={selected}
      disabled={unavailable}
      tabIndex={tabIndex}
      onClick={onClick}
      onFocus={onFocus}
    >
      <span className="game-cover">
        {sharedCover ? <span data-cover-slot /> : <Cover game={game} eager={eager} />}
        {job && <span className="game-building-chip">{jobLabel(job)}</span>}
        {unavailable && (
          <span className="game-building-chip">
            {game.creationStatus === 'creating' ? 'Creating…' : 'Setup failed'}
          </span>
        )}
        {!game.publishedReleaseId && <span className="game-new-badge">New</span>}
        {game.logoUrl && (
          <DisplayImage
            className="game-logo"
            src={game.logoUrl}
            image={game.logoImage}
            sizes="(max-width: 600px) 80vw, 560px"
            priority={eager}
            keepShown
          />
        )}
        <span className="game-tile-meta">
          {!game.logoUrl && <strong>{game.title}</strong>}
          {tags.length > 0 && (
            <span className="game-tag-icons" aria-label={tags.join(', ')}>
              {tags.map((tag) => (
                <span
                  key={tag}
                  style={{ '--tag-color': colors.get(genreIcon(tag)) ?? 'var(--aqua-b)' } as CSSProperties}
                >
                  <Icon name={genreIcon(tag)} />
                </span>
              ))}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

export function jobLabel(job: JobView): string {
  const words = job.friendlyState ?? job.stageText ?? job.state.replaceAll('_', ' ');
  return job.progressPercent == null ? words : `${words} ${job.progressPercent}%`;
}
