import type { ReactNode } from 'react';
import type { Round } from './RoundReviews';
import './round-media.css';

type Item = Round['media'][number];

function MediaItem({ item }: { item: Item }) {
  return (
    <div className="review-deck-playable worker-review-media">
      {item.kind === 'still' ? (
        <img className="review-deck-media" src={item.url} alt={item.role === 'target' ? 'Concept target' : 'Review'} />
      ) : item.kind === 'audio' ? (
        <audio src={item.url} controls aria-label="Review audio" />
      ) : (
        <video
          className="review-deck-media"
          style={{ pointerEvents: 'auto' }}
          src={item.url}
          controls
          playsInline
          autoPlay
          muted
          loop
        />
      )}
    </div>
  );
}

export function RoundMedia({ media, playable }: { media: readonly Item[]; playable?: ReactNode }) {
  const target = media.find((item) => item.kind === 'still' && item.role === 'target');
  const primary = media.find((item) => item.role !== 'target' && (item.kind === 'still' || item.kind === 'clip'));
  const comparePlayable = Boolean(target && !primary && playable);
  const compared = Boolean(target && (primary || playable));
  return (
    <>
      {target && compared && (
        <div className="worker-review-compare" aria-label="Concept target and review">
          <MediaItem item={target} />
          {primary ? <MediaItem item={primary} /> : playable}
        </div>
      )}
      {media
        .filter((item) => !compared || (item !== target && item !== primary))
        .map((item, index) => (
          <MediaItem key={`${item.url}:${index}`} item={item} />
        ))}
      {!comparePlayable && playable}
    </>
  );
}
