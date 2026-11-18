import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';

type Verdict = 'approved' | 'needs_work';

export function SwipeVerdict({
  children,
  disabled,
  onSend,
  onPendingChange,
}: {
  children: ReactNode;
  disabled: boolean;
  onSend(verdict: Verdict, note: string): Promise<void>;
  onPendingChange?(pending: boolean): void;
}) {
  const [note, setNote] = useState('');
  const [notesOpen, setNotesOpen] = useState(false);
  const [pending, setPending] = useState<{ verdict: Verdict; note: string }>();
  const [sending, setSending] = useState(false);
  const [zoom, setZoom] = useState<{ src: string; alt: string }>();
  const start = useRef<
    { id: number; x: number; y: number; moved: boolean; image?: { src: string; alt: string } } | undefined
  >(undefined);
  const send = useRef(onSend);
  send.current = onSend;
  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => {
      setSending(true);
      void send
        .current(pending.verdict, pending.note)
        .catch(() => {})
        .finally(() => {
          setSending(false);
          setPending(undefined);
        });
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [pending]);
  useEffect(() => {
    onPendingChange?.(Boolean(pending) || sending || notesOpen || Boolean(zoom));
    return () => onPendingChange?.(false);
  }, [onPendingChange, pending, sending, notesOpen, zoom]);
  const vote = (verdict: Verdict) => {
    if (disabled || pending || sending) return;
    if (verdict === 'needs_work') setNotesOpen(true);
    else setPending({ verdict, note: '' });
  };
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.isPrimary === false) {
      start.current = undefined;
      event.currentTarget.style.transform = '';
      event.currentTarget.style.removeProperty('--vote-like');
      event.currentTarget.style.removeProperty('--vote-dislike');
      delete event.currentTarget.dataset.dragging;
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest('button, a, audio, input, textarea')) return;
    const video = target.closest('video');
    // Keep the browser's native playback controls interactive; the picture above them is draggable.
    if (video && event.clientY >= video.getBoundingClientRect().bottom - 48) return;
    const image = (event.target as HTMLElement).closest('.review-deck-playable')?.querySelector('img');
    start.current = {
      x: event.clientX,
      y: event.clientY,
      id: event.pointerId,
      moved: false,
      ...(image ? { image: { src: image.src, alt: image.alt } } : {}),
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is optional in embedded browsers.
    }
  };
  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!start.current || event.pointerId !== start.current.id) return;
    const dx = event.clientX - start.current.x;
    const dy = event.clientY - start.current.y;
    const image = start.current.image;
    const moved = start.current.moved;
    start.current = undefined;
    event.currentTarget.style.transform = '';
    event.currentTarget.style.removeProperty('--vote-like');
    event.currentTarget.style.removeProperty('--vote-dislike');
    delete event.currentTarget.dataset.dragging;
    if (Math.abs(dx) >= 80 && Math.abs(dx) > Math.abs(dy)) vote(dx > 0 ? 'approved' : 'needs_work');
    else if (!moved && Math.abs(dx) < 8 && Math.abs(dy) < 8 && image) setZoom(image);
  };
  return (
    <>
      <div className="review-deck-stage worker-review-stage">
        <div
          className="review-deck-card worker-review-swipe"
          tabIndex={0}
          aria-label="Review media; press Enter to zoom an image"
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            const image = event.currentTarget.querySelector('img');
            if (image) setZoom({ src: image.src, alt: image.alt });
          }}
          onPointerDown={pointerDown}
          onPointerMove={(event) => {
            if (!start.current || event.pointerId !== start.current.id) return;
            const dx = event.clientX - start.current.x;
            const dy = event.clientY - start.current.y;
            if (Math.abs(dx) >= 8 || Math.abs(dy) >= 8) start.current.moved = true;
            if (disabled || pending || sending) return;
            if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy)) return;
            event.currentTarget.dataset.dragging = 'true';
            event.currentTarget.style.transform = `translateX(${dx}px) rotate(${Math.max(-12, Math.min(12, dx / 18))}deg)`;
            event.currentTarget.style.setProperty('--vote-like', String(Math.max(0, Math.min(1, dx / 80))));
            event.currentTarget.style.setProperty('--vote-dislike', String(Math.max(0, Math.min(1, -dx / 80))));
          }}
          onPointerUp={pointerUp}
          onPointerCancel={(event) => {
            start.current = undefined;
            event.currentTarget.style.transform = '';
            event.currentTarget.style.removeProperty('--vote-like');
            event.currentTarget.style.removeProperty('--vote-dislike');
            delete event.currentTarget.dataset.dragging;
          }}
        >
          {children}
          <span className="review-deck-stamp review-deck-stamp-like worker-vote-like">
            <Icon name="thumbsUp" />
          </span>
          <span className="review-deck-stamp review-deck-stamp-dislike worker-vote-dislike">
            <Icon name="thumbsDown" />
          </span>
        </div>
      </div>
      <div className="review-deck-actions">
        <button
          type="button"
          className="review-deck-undo tap-secondary"
          aria-label="Undo"
          disabled={!pending || sending}
          onClick={() => setPending(undefined)}
        >
          <Icon name="rollback" />
        </button>
        <button
          type="button"
          className="review-deck-thumb tap-secondary"
          aria-label="Needs changes"
          disabled={disabled || Boolean(pending) || sending}
          onClick={() => vote('needs_work')}
        >
          <Icon name="thumbsDown" />
        </button>
        <button
          type="button"
          className="review-deck-thumb tap-secondary"
          aria-label="Looks good"
          disabled={disabled || Boolean(pending) || sending}
          onClick={() => vote('approved')}
        >
          <Icon name="thumbsUp" />
        </button>
      </div>
      {pending && !sending && (
        <div role="status" className="review-deck-progress">
          Sending in 5 seconds
        </div>
      )}
      {notesOpen && (
        <div
          onKeyDown={(event) => {
            if (event.key === 'Escape') event.stopPropagation();
          }}
        >
          <Dialog
            title="Needs changes"
            className="review-deck-reason"
            backdropClassName="review-deck-reason-backdrop worker-review-sheet-backdrop"
            onClose={() => setNotesOpen(false)}
          >
            <label>
              Note (optional)
              <textarea value={note} maxLength={3900} onChange={(event) => setNote(event.target.value)} />
            </label>
            <div className="review-deck-reason-actions">
              <button
                type="button"
                onClick={() => {
                  setNotesOpen(false);
                  setPending({ verdict: 'needs_work', note });
                }}
              >
                Send changes
              </button>
              <button type="button" onClick={() => setNotesOpen(false)}>
                Cancel
              </button>
            </div>
          </Dialog>
        </div>
      )}
      {zoom && (
        <div
          onKeyDown={(event) => {
            if (event.key === 'Escape') event.stopPropagation();
          }}
        >
          <Dialog
            title="Review image"
            className="review-deck-fullscreen"
            backdropClassName="review-deck-fullscreen-backdrop worker-review-sheet-backdrop"
            onClose={() => setZoom(undefined)}
          >
            <div className="review-deck-fullscreen-media">
              <img src={zoom.src} alt={zoom.alt} />
            </div>
            <button type="button" onClick={() => setZoom(undefined)}>
              Close
            </button>
          </Dialog>
        </div>
      )}
    </>
  );
}
