import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { commandPath, commandSource, type ReviewCommand } from './review-command';
import { api } from '../../lib/api/client';
import { queryClient } from '../../app/query';
import { creatorCommandsQueryKey, gameCommandsQueryKey } from '../commands-inbox/commands';
import { letterOf, mediaKindOf, withoutLinks } from '../commands-inbox/review';
import { PlayableCard } from '../commands-inbox/playable';
import { Dialog } from '../../components/Dialog';
import './command-review-card.css';

export function CommandReviewCard({
  command,
  onAnswered,
  ticketState,
  onSendingChange,
}: {
  command: ReviewCommand;
  onAnswered(): void;
  ticketState?: string;
  onSendingChange?(sending: boolean): void;
}) {
  const [note, setNote] = useState('');
  const [votes, setVotes] = useState<Record<string, 'like' | 'dislike'>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [selectedOption, setSelectedOption] = useState(command.options[0]?.id ?? '');
  const [sending, setSending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);
  const [zoom, setZoom] = useState<{ url: string; label: string }>();
  const drag = useRef<{ id: number; x: number; y: number } | undefined>(undefined);
  const suppressImageClick = useRef(false);
  useEffect(() => {
    setSaved(false);
    setSelectedOption(command.options[0]?.id ?? '');
    setVotes({});
    setReasons({});
    setError(false);
  }, [command.version]);
  const selected = command.options.find((option) => option.id === selectedOption) ?? command.options[0];
  useEffect(() => {
    onSendingChange?.(sending);
    return () => onSendingChange?.(false);
  }, [onSendingChange, sending]);
  const coreState = useQuery({
    queryKey: ['core-review-state', command.ticket],
    enabled: saved && 'source' in command && Boolean(command.ticket),
    queryFn: () => api<{ state: string }>(`/core/tickets/${encodeURIComponent(command.ticket!)}/state`),
    refetchInterval: 5000,
    retry: false,
  });
  const send = async (
    optionId: string,
    review: {
      likes: string[];
      dislikes: { option_id: string; reason?: string }[];
      liked_notes?: { option_id: string; reason: string }[];
      notes?: string;
    },
  ) => {
    setSending(true);
    setError(false);
    try {
      await api(`${commandPath(command)}/${encodeURIComponent(command.decision_id)}/answer`, {
        method: 'POST',
        json: {
          option_id: optionId,
          version: command.version,
          review,
        },
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: creatorCommandsQueryKey }),
        queryClient.invalidateQueries({ queryKey: gameCommandsQueryKey(commandSource(command)) }),
      ]);
      setSaved(true);
      onAnswered();
    } catch {
      setError(true);
    } finally {
      setSending(false);
    }
  };
  const likes = command.options.filter(({ id }) => votes[id] === 'like').map(({ id }) => id);
  const dislikes = command.options.filter(({ id }) => votes[id] === 'dislike');
  const optionId = likes[0] ?? command.recommend ?? command.options[0]?.id ?? '';
  const canSend = likes.length > 0 || dislikes.length > 0 || Boolean(note.trim());
  const sendReview = (none = false) => {
    const review = {
      likes: none ? [] : likes,
      dislikes: (none ? command.options : dislikes).map(({ id }) => ({
        option_id: id,
        ...(!none && reasons[id]?.trim() ? { reason: reasons[id]!.trim() } : {}),
      })),
      ...(!none && likes.some((id) => reasons[id]?.trim())
        ? {
            liked_notes: command.options.flatMap(({ id }) =>
              votes[id] === 'like' && reasons[id]?.trim() ? [{ option_id: id, reason: reasons[id]!.trim() }] : [],
            ),
          }
        : {}),
      ...(note.trim() ? { notes: note.trim() } : {}),
    };
    void send(optionId, review);
  };
  const startPaging = (event: PointerEvent<HTMLDivElement>) => {
    if (event.isPrimary === false) {
      drag.current = undefined;
      return;
    }
    if (sending || saved) return;
    const target = event.target as HTMLElement;
    if (target.closest('audio, input, textarea, a, button:not(.worker-review-image), .review-deck-playable')) return;
    const video = target.closest('video');
    if (video && event.clientY >= video.getBoundingClientRect().bottom - 48) return;
    suppressImageClick.current = false;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
  };
  const movePaging = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy)) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is optional in embedded browsers.
    }
  };
  const endPaging = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    drag.current = undefined;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) <= Math.abs(dy)) return;
    suppressImageClick.current = true;
    window.setTimeout(() => {
      suppressImageClick.current = false;
    }, 0);
    const index = command.options.findIndex((option) => option.id === selected?.id);
    const next = command.options[Math.max(0, Math.min(command.options.length - 1, index + (dx < 0 ? 1 : -1)))];
    if (next) setSelectedOption(next.id);
  };
  return (
    <section className="review-deck" aria-label={command.summary ?? command.title}>
      <p>{withoutLinks(command.question)}</p>
      {command.recommend ? (
        <p className="worker-review-recommendation">
          Recommended: {letterOf(command.options, command.recommend)}:{' '}
          {withoutLinks(command.options.find(({ id }) => id === command.recommend)?.label ?? '')}
        </p>
      ) : null}
      <label>
        Note (optional)
        <textarea
          value={note}
          disabled={sending || saved}
          maxLength={2000}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <div className="worker-review-option-pages" aria-label="Review options">
        {command.options.map((option, index) => (
          <button
            type="button"
            className="worker-review-page tap-secondary"
            key={option.id}
            aria-label={`View option ${String.fromCharCode(65 + index)}`}
            aria-pressed={selected?.id === option.id}
            disabled={sending || saved}
            onClick={() => setSelectedOption(option.id)}
          >
            {String.fromCharCode(65 + index)}
          </button>
        ))}
      </div>
      <div
        className="worker-review-options"
        aria-label="Current option"
        onPointerDown={startPaging}
        onPointerMove={movePaging}
        onPointerUp={endPaging}
        onPointerCancel={() => {
          drag.current = undefined;
        }}
      >
        {command.options.map((option) => (
          <div className="worker-review-option review-deck-card" key={option.id} hidden={option.id !== selected?.id}>
            {option.id === selected?.id && option.playable ? (
              <PlayableCard gameId={commandSource(command)} card={option} options={command.options} />
            ) : option.id === selected?.id && option.media && mediaKindOf(option.media) === 'audio' ? (
              <audio controls src={option.media.url} aria-label={option.label} />
            ) : option.id === selected?.id && option.media && mediaKindOf(option.media) === 'video' ? (
              <video controls playsInline autoPlay muted loop src={option.media.url} className="review-deck-media" />
            ) : option.id === selected?.id && option.media ? (
              <button
                type="button"
                className="worker-review-image"
                onClick={() => {
                  if (suppressImageClick.current) {
                    suppressImageClick.current = false;
                    return;
                  }
                  setZoom({ url: option.media!.url, label: option.label });
                }}
              >
                <img src={option.media.url} alt={option.label} className="review-deck-media" />
              </button>
            ) : null}
            {option.id === selected?.id && option.audio && (
              <audio controls src={option.audio.url} aria-label={`${option.label} audio`} />
            )}
            {option.id === selected?.id &&
              option.audioClips?.map((clip, index) => (
                <audio
                  key={`${clip.url}:${index}`}
                  controls
                  src={clip.url}
                  aria-label={`${option.label} audio ${index + 2}`}
                />
              ))}
            <div
              className="worker-review-votes"
              aria-label={`Rate ${letterOf(command.options, option.id)}: ${withoutLinks(option.label)}`}
            >
              <button
                type="button"
                aria-pressed={votes[option.id] === 'like'}
                disabled={sending || saved}
                onClick={() =>
                  setVotes((current) => {
                    const next = { ...current };
                    if (next[option.id] === 'like') delete next[option.id];
                    else next[option.id] = 'like';
                    return next;
                  })
                }
              >
                👍
              </button>
              <button
                type="button"
                aria-pressed={votes[option.id] === 'dislike'}
                disabled={sending || saved}
                onClick={() =>
                  setVotes((current) => {
                    const next = { ...current };
                    if (next[option.id] === 'dislike') delete next[option.id];
                    else next[option.id] = 'dislike';
                    return next;
                  })
                }
              >
                👎
              </button>
            </div>
            {votes[option.id] || reasons[option.id] ? (
              <label className="worker-review-option-note">
                Note for {letterOf(command.options, option.id)} (optional)
                <textarea
                  value={reasons[option.id] ?? ''}
                  disabled={sending || saved}
                  maxLength={1000}
                  onChange={(event) => setReasons((current) => ({ ...current, [option.id]: event.target.value }))}
                />
              </label>
            ) : null}
          </div>
        ))}
      </div>
      <div className="worker-review-submit">
        <button
          className="worker-review-change"
          disabled={sending || saved || !canSend}
          type="button"
          onClick={() => sendReview()}
        >
          Send
        </button>
        <button
          className="worker-review-change"
          disabled={sending || saved}
          type="button"
          onClick={() => sendReview(true)}
        >
          None of these
        </button>
      </div>
      {saved && (
        <p role="status">
          Saved · sent to agent · Ticket state:{' '}
          {('source' in command ? coreState.data?.state : ticketState) ?? 'updating'}
        </p>
      )}
      {error && <p role="alert">That answer did not send. Try again.</p>}
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
              <img src={zoom.url} alt={zoom.label} />
            </div>
            <button type="button" onClick={() => setZoom(undefined)}>
              Close
            </button>
          </Dialog>
        </div>
      )}
    </section>
  );
}
