import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { Icon } from '../../components/Icon';
import { Cover } from './Cover';
import { splatMask } from './splatMask';
import type { GameSummary } from './types';

export function ShowcaseSpotlight({
  game,
  canOpen,
  onPlay,
  onEdit,
  onClose,
}: {
  game: GameSummary;
  canOpen: boolean;
  onPlay(): void;
  onEdit(): void;
  onClose(): void;
}) {
  const close = useRef<HTMLButtonElement>(null);
  const starId = useId();
  const [mask, setMask] = useState<string>();
  const data = game.showcase!;
  useEffect(() => close.current?.focus(), [game.id]);
  useEffect(() => {
    let active = true;
    setMask(undefined);
    void splatMask(data.id).then((value) => { if (active) setMask(value); });
    return () => { active = false; };
  }, [data.id]);
  return (
    <section
      className="games-spotlight showcase-spotlight"
      aria-live="polite"
      aria-label={`${game.title} spotlight`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className="showcase-ambient" aria-hidden="true"><Cover game={game} hero /></div>
      <button ref={close} type="button" className="games-close" aria-label="Close game" onClick={onClose}>
        <span aria-hidden="true">×</span>
      </button>
      <div className="games-spotlight-copy">
        <h1 style={{ fontFamily: `'${data.font}', var(--display)` }}>{game.title}</h1>
        <p className="games-tagline">{data.tagline}</p>
        <ul className="showcase-tags" aria-label="Tags">
          {data.displayTags.map((tag, index) => (
            <li key={`${tag.kind}:${tag.key}:${index}`} style={{ '--tag-color': tag.color } as CSSProperties}>
              <span>
                <Icon name={tag.key} />
              </span>
              {tag.label}
            </li>
          ))}
        </ul>
        <dl className="showcase-stats">
          <div>
            <dt>Time played</dt>
            <dd>{data.played || '0m'}</dd>
          </div>
          <div>
            <dt>Rating</dt>
            <dd className="showcase-stars" aria-label={data.rating ? `${data.rating} out of 5` : 'Not rated yet'}>
              {Array.from({ length: 5 }, (_, index) => {
                const fill = Math.max(0, Math.min(1, (data.rating ?? 0) - index)) * 100;
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
              <small>{data.rating ?? 'New'}</small>
            </dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd>v{data.version}</dd>
          </div>
          <div>
            <dt>Plays</dt>
            <dd>{data.plays}</dd>
          </div>
        </dl>
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
    <div className="games-spotlight-media" data-splat={Boolean(mask)} style={mask ? { maskImage: `url(${mask})`, WebkitMaskImage: `url(${mask})` } : undefined} aria-hidden="true">
        <span className="game-cover">
          <Cover game={game} hero />
        </span>
      </div>
    </section>
  );
}
