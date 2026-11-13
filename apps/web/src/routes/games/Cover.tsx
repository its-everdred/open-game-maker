import type { GameSummary } from './types';
import { ShowcaseCover } from './ShowcaseCover';

type CoverGame = Pick<GameSummary, 'title' | 'coverUrl' | 'showcase'>;

export function Cover({ game, hero = false }: { game: CoverGame; hero?: boolean }) {
  if (game.showcase) return <ShowcaseCover id={game.showcase.id} title={game.title} hero={hero} />;
  if (game.coverUrl) {
    return <img className="game-cover-image" src={game.coverUrl} alt="" loading="lazy" />;
  }

  return (
    <div className="game-cover-placeholder" aria-hidden="true">
      <span>{game.title}</span>
    </div>
  );
}
