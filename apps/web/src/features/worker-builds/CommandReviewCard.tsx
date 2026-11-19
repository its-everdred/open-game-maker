import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { commandPath, commandSource, type ReviewCommand } from './review-command';
import { api } from '../../lib/api/client';
import { queryClient } from '../../app/query';
import { creatorCommandsQueryKey, gameCommandsQueryKey } from '../commands-inbox/commands';
import { mediaKindOf, withoutLinks } from '../commands-inbox/review';
import { PlayableCard } from '../commands-inbox/playable';
import { Dialog } from '../../components/Dialog';

export function CommandReviewCard({
  command,
  onAnswered,
  ticketState,
  onSendingChange,
  onPickingChange,
}: {
  command: ReviewCommand;
  onAnswered(): void;
  ticketState?: string;
  onSendingChange?(sending: boolean): void;
  onPickingChange?(picking: boolean): void;
}) {
  const [note, setNote] = useState('');
  const [selectedOption, setSelectedOption] = useState(command.options[0]?.id ?? '');
  const [sending, setSending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);
  const [zoom, setZoom] = useState<{ url: string; label: string }>();
  const [picking, setPicking] = useState<{ id: string; label: string; version: number }>();
  const drag = useRef<{ id: number; x: number; y: number } | undefined>(undefined);
  const suppressImageClick = useRef(false);
  useEffect(() => {
    setSaved(false);
    setSelectedOption(command.options[0]?.id ?? '');
    setPicking(undefined);
    setError(false);
  }, [command.version]);
  const selected = command.options.find((option) => option.id === selectedOption) ?? command.options[0];
  useEffect(() => {
    onSendingChange?.(sending);
    return () => onSendingChange?.(false);
  }, [onSendingChange, sending]);
  useEffect(() => {
    onPickingChange?.(Boolean(picking));
    return () => onPickingChange?.(false);
  }, [onPickingChange, picking]);
  const coreState = useQuery({
    queryKey: ['core-review-state', command.ticket],
    enabled: saved && 'source' in command && Boolean(command.ticket),
    queryFn: () => api<{ state: string }>(`/core/tickets/${encodeURIComponent(command.ticket!)}/state`),
    refetchInterval: 5000,
    retry: false,
  });
  const send = async (optionId: string, change: boolean) => {
    setSending(true);
    setError(false);
    try {
      await api(`${commandPath(command)}/${encodeURIComponent(command.decision_id)}/answer`, {
        method: 'POST',
        json: {
          option_id: optionId,
          version: command.version,
          ...(change ? { change_request: true } : {}),
          ...(change
            ? { review: { likes: [], dislikes: [{ option_id: optionId }], notes: note.trim() } }
            : { review: { likes: [optionId], dislikes: [], ...(note.trim() ? { notes: note.trim() } : {}) } }),
        },
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: creatorCommandsQueryKey }),
        queryClient.invalidateQueries({ queryKey: gameCommandsQueryKey(commandSource(command)) }),
      ]);
      setSaved(true);
      setPicking(undefined);
      onAnswered();
    } catch {
      setError(true);
    } finally {
      setSending(false);
    }
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
        {command.options.map(
          (option, index) =>
            option.id === selected?.id && (
              <div className="worker-review-option review-deck-card" key={option.id}>
                {option.playable ? (
                  <PlayableCard gameId={commandSource(command)} card={option} options={command.options} />
                ) : option.media && mediaKindOf(option.media) === 'audio' ? (
                  <audio controls src={option.media.url} aria-label={option.label} />
                ) : option.media && mediaKindOf(option.media) === 'video' ? (
                  <video
                    controls
                    playsInline
                    autoPlay
                    muted
                    loop
                    src={option.media.url}
                    className="review-deck-media"
                  />
                ) : option.media ? (
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
                {option.audio && <audio controls src={option.audio.url} aria-label={`${option.label} audio`} />}
                {option.audioClips?.map((clip, index) => (
                  <audio
                    key={`${clip.url}:${index}`}
                    controls
                    src={clip.url}
                    aria-label={`${option.label} audio ${index + 2}`}
                  />
                ))}
                <button
                  disabled={sending || saved}
                  type="button"
                  onClick={() => {
                    setError(false);
                    setPicking({
                      id: option.id,
                      label: `Pick ${String.fromCharCode(65 + index)}: ${withoutLinks(option.label)}`,
                      version: command.version,
                    });
                  }}
                >
                  Pick {String.fromCharCode(65 + index)}: {withoutLinks(option.label)}
                </button>
              </div>
            ),
        )}
      </div>
      <button
        className="worker-review-change"
        disabled={sending || saved || !note.trim() || !selected}
        type="button"
        onClick={() => selected && void send(selected.id, true)}
      >
        Send changes
      </button>
      {saved && (
        <p role="status">
          Saved · sent to agent · Ticket state:{' '}
          {('source' in command ? coreState.data?.state : ticketState) ?? 'updating'}
        </p>
      )}
      {error && <p role="alert">That answer did not send. Try again.</p>}
      {picking && picking.version === command.version && (
        <div onKeyDown={(event) => event.stopPropagation()}>
          <Dialog
            title={picking.label}
            className="review-deck-reason"
            backdropClassName="review-deck-reason-backdrop worker-review-sheet-backdrop"
            onClose={() => {
              if (!sending) setPicking(undefined);
            }}
          >
            <label>
              Note (optional)
              <textarea
                value={note}
                disabled={sending}
                maxLength={2000}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            {error && <p role="alert">That answer did not send. Try again.</p>}
            <div className="review-deck-reason-actions">
              <button
                type="button"
                disabled={sending}
                onClick={() => {
                  if (picking.version === command.version) void send(picking.id, false);
                }}
              >
                Send choice
              </button>
              <button type="button" disabled={sending} onClick={() => setPicking(undefined)}>
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
