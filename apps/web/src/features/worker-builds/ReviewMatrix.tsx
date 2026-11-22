import { useState } from 'react';
import type { MediaMeta as MediaMetaValue } from '@ogm/contracts';
import { Dialog } from '../../components/Dialog';
import { MediaMeta } from './MediaMeta';
import './review-matrix.css';

type MatrixCell = {
  optionId: string;
  label: string;
  media: { url: string; kind?: 'image' | 'video' | 'audio'; poster?: string };
  original?: boolean;
  meta?: MediaMetaValue;
};
type MatrixRow = { id: string; label: string; cells: MatrixCell[] };
type Vote = { verdict?: 'like' | 'dislike'; note?: string };
type ReviewMatrixProps = {
  rows: MatrixRow[];
  votes: Record<string, Vote>;
  onVote(optionId: string, vote: Vote): void;
  disabled?: boolean;
};

export function ReviewMatrix({ rows, votes, onVote, disabled = false }: ReviewMatrixProps) {
  const [active, setActive] = useState<MatrixCell>();
  const [note, setNote] = useState('');
  const zoom = (cell: MatrixCell) => {
    setActive(cell);
    setNote(votes[cell.optionId]?.note ?? '');
  };
  const vote = (cell: MatrixCell, verdict: Vote['verdict'], nextNote = votes[cell.optionId]?.note ?? '') => {
    onVote(cell.optionId, { ...(verdict ? { verdict } : {}), ...(nextNote ? { note: nextNote } : {}) });
  };
  const media = (cell: MatrixCell) => {
    const kind = cell.media.kind ?? 'image';
    if (kind === 'video') {
      return (
        <video
          src={cell.media.url}
          poster={cell.media.poster}
          autoPlay
          muted
          loop
          playsInline
          aria-label={cell.label}
        />
      );
    }
    if (kind === 'audio') return <audio src={cell.media.url} controls aria-label={cell.label} />;
    return <img src={cell.media.url} alt={cell.label} />;
  };
  const actions = (cell: MatrixCell, value: Vote = votes[cell.optionId] ?? {}, inDialog = false) => (
    <div className="review-matrix-actions" aria-label={`${cell.label} vote`}>
      <button
        type="button"
        aria-label={`Like ${cell.label}`}
        aria-pressed={value.verdict === 'like'}
        disabled={disabled}
        onClick={() => vote(cell, 'like', inDialog ? note : value.note)}
      >
        👍
      </button>
      <button
        type="button"
        aria-label={`Dislike ${cell.label}`}
        aria-pressed={value.verdict === 'dislike'}
        disabled={disabled}
        onClick={() => vote(cell, 'dislike', inDialog ? note : value.note)}
      >
        👎
      </button>
      <button type="button" aria-label={`Add note for ${cell.label}`} disabled={disabled} onClick={() => zoom(cell)}>
        ✎
      </button>
    </div>
  );

  return (
    <div className="review-matrix">
      {rows.map((row) => (
        <section className="review-matrix-row" key={row.id} aria-label={row.label} role="region">
          <h3>{row.label}</h3>
          <div className="review-matrix-cells">
            {row.cells.map((cell) => (
              <article className="review-matrix-cell" key={cell.optionId}>
                <button
                  type="button"
                  className="review-matrix-media"
                  aria-label={`Enlarge ${cell.label}`}
                  onClick={() => zoom(cell)}
                >
                  {media(cell)}
                </button>
                <p>{cell.original ? 'Original' : cell.label}</p>
                {cell.meta && <MediaMeta meta={cell.meta} />}
                {!cell.original && actions(cell)}
              </article>
            ))}
          </div>
        </section>
      ))}
      {active && (
        <Dialog
          title={active.label}
          className="review-deck-fullscreen review-matrix-dialog"
          backdropClassName="review-deck-fullscreen-backdrop worker-review-sheet-backdrop review-matrix-backdrop"
          onClose={() => setActive(undefined)}
        >
          {(() => {
            const original = active.original
              ? undefined
              : rows
                  .find((row) => row.cells.some((cell) => cell.optionId === active.optionId))
                  ?.cells.find((cell) => cell.original);
            return (
              <div
                className={original ? 'review-matrix-dialog-media review-matrix-compare' : 'review-matrix-dialog-media'}
              >
                {original && (
                  <figure>
                    {media(original)}
                    {original.meta && <MediaMeta meta={original.meta} />}
                  </figure>
                )}
                <figure>
                  {media(active)}
                  {active.meta && <MediaMeta meta={active.meta} />}
                </figure>
              </div>
            );
          })()}
          {!active.original && actions(active, { ...votes[active.optionId], note }, true)}
          {!active.original && (
            <label>
              Note for {active.label}
              <textarea
                value={note}
                disabled={disabled}
                maxLength={1000}
                onChange={(event) => {
                  const next = event.target.value;
                  setNote(next);
                  vote(active, votes[active.optionId]?.verdict, next);
                }}
              />
            </label>
          )}
          <button type="button" onClick={() => setActive(undefined)}>
            Close
          </button>
        </Dialog>
      )}
    </div>
  );
}
