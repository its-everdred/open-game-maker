import { useEffect, useState } from 'react';

import type { GameFrameState } from '../../features/editor/frame';
import { Cover } from '../games/Cover';
import { DisplayImage as ResponsiveImage } from '../games/DisplayImage';
import type { DisplayImage } from '../games/types';

type LoadingGame = {
  familyId: string;
  title: string;
  coverUrl?: string | null;
  logoUrl?: string | null;
  loadingUrls?: { portrait: string; landscape: string };
  loadingImages?: { portrait: DisplayImage; landscape: DisplayImage };
  coverImage?: DisplayImage | null;
  logoImage?: DisplayImage | null;
};
type LayerPhase = 'visible' | 'leaving' | 'removed';

const FADE_MS = 220;

export function LoadingLayer({
  game,
  load,
  firstFrame,
}: {
  game: LoadingGame;
  load?: GameFrameState['load'];
  firstFrame?: boolean;
}) {
  const done = load?.done === true && firstFrame === true;
  const [phase, setPhase] = useState<LayerPhase>('visible');
  const [painted, setPainted] = useState(false);

  useEffect(() => {
    if (!done) {
      setPainted(false);
      return;
    }
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setPainted(true));
    });
    return () => cancelAnimationFrame(frame);
  }, [done]);

  useEffect(() => {
    if (!done || !painted) {
      if (phase === 'removed' || phase === 'leaving') setPhase('visible');
      return;
    }
    if (phase === 'visible') {
      if (prefersReducedMotion()) setPhase('removed');
      else setPhase('leaving');
      return;
    }
    if (phase !== 'leaving') return;
    const timer = setTimeout(() => setPhase('removed'), FADE_MS);
    return () => clearTimeout(timer);
  }, [done, painted, phase]);

  if (done && phase === 'removed') return null;

  const percent =
    load === undefined || load.total <= 0 ? 0 : Math.round(Math.min(1, Math.max(0, load.loaded / load.total)) * 100);
  return (
    <div className={`game-loading-layer${done && phase === 'leaving' ? ' is-done' : ''}`}>
      <div className="game-loading-cover">
        <Cover game={game} />
      </div>
      {game.loadingUrls && game.loadingImages ? (
        <ResponsiveLoadingArt urls={game.loadingUrls} images={game.loadingImages} />
      ) : game.loadingUrls ? (
        <picture className="game-loading-art">
          <source media="(orientation: landscape)" srcSet={game.loadingUrls.landscape} />
          <img src={game.loadingUrls.portrait} alt="" fetchPriority="high" />
        </picture>
      ) : null}
      <div className="game-loading-glass">
        {game.logoUrl ? (
          <ResponsiveImage
            className="game-loading-logo"
            src={game.logoUrl}
            image={game.logoImage}
            sizes="(max-width: 600px) 80vw, 560px"
            priority
          />
        ) : null}
        <div
          className="game-loading-progress"
          role="progressbar"
          aria-label="Loading"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <span style={{ width: `${percent}%` }} />
        </div>
      </div>
    </div>
  );
}

function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function ResponsiveLoadingArt({
  urls,
  images,
}: {
  urls: NonNullable<LoadingGame['loadingUrls']>;
  images: NonNullable<LoadingGame['loadingImages']>;
}) {
  const set = (image: DisplayImage, format: 'avif' | 'webp' | 'png') =>
    image.sources[format].map(({ path, width }) => `${path} ${width}w`).join(', ');
  return (
    <picture className="game-loading-art">
      {(['avif', 'webp', 'png'] as const).map((format) => (
        <source
          key={`l-${format}`}
          media="(orientation: landscape)"
          type={`image/${format}`}
          srcSet={set(images.landscape, format)}
          sizes="100vw"
        />
      ))}
      {(['avif', 'webp'] as const).map((format) => (
        <source key={`p-${format}`} type={`image/${format}`} srcSet={set(images.portrait, format)} sizes="100vw" />
      ))}
      <img
        src={urls.portrait}
        srcSet={set(images.portrait, 'png')}
        sizes="100vw"
        width={images.portrait.width}
        height={images.portrait.height}
        alt=""
        fetchPriority="high"
      />
    </picture>
  );
}
