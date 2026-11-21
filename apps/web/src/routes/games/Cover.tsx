import type { GameSummary } from './types';
import { DisplayImage } from './DisplayImage';
import { ShowcaseCover } from './ShowcaseCover';

type CoverGame = Pick<GameSummary, 'title' | 'coverUrl' | 'coverImage' | 'logoUrl' | 'showcase' | 'slotImages'>;

export function Cover({ game, hero = false }: { game: CoverGame; hero?: boolean }) {
  if (game.coverUrl) {
    return (
      <DisplayImage
        className="game-cover-image"
        src={game.coverUrl}
        image={game.coverImage}
        variants={game.slotImages?.tile}
        sizes={
          hero
            ? '(max-width: 600px) 85vw, (max-width: 1000px) 50vw, 640px'
            : '(max-width: 600px) 45vw, (max-width: 1000px) 25vw, 240px'
        }
        priority={hero}
      />
    );
  }

  if (game.showcase) return <ShowcaseCover id={game.showcase.id} title={game.logoUrl ? '' : game.title} hero={hero} />;

  return (
    <div className="game-cover-placeholder" aria-hidden="true">
      {!game.logoUrl && <span>{game.title}</span>}
    </div>
  );
}
