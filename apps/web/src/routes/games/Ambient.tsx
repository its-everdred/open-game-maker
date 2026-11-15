import { Cover } from './Cover';
import type { GameSummary } from './types';

// Prefer the same art as the cover; a trailer's first frame is useful when no thumbnail exists.
export function Ambient({ game }: { game: GameSummary }) {
  if (!game.coverUrl && !game.showcase && !game.trailerUrl) return null;
  return (
    <div className="showcase-ambient" aria-hidden="true">
      {!game.coverUrl && game.trailerUrl ? (
        <video src={game.trailerUrl} muted playsInline preload="auto" tabIndex={-1} />
      ) : (
        <Cover game={game} hero />
      )}
    </div>
  );
}
