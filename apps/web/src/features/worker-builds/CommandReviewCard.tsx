import { useEffect, useState } from 'react';
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
}: {
  command: ReviewCommand;
  onAnswered(): void;
  ticketState?: string;
  onSendingChange?(sending: boolean): void;
}) {
  const [note, setNote] = useState('');
  const [changeOption, setChangeOption] = useState('');
  const [sending, setSending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);
  const [zoom, setZoom] = useState<{ url: string; label: string }>();
  useEffect(() => {
    setSaved(false);
    setChangeOption('');
    setError(false);
  }, [command.version]);
  const coreState = useQuery({
    queryKey: ['core-review-state', command.ticket],
    enabled: saved && 'source' in command && Boolean(command.ticket),
    queryFn: () => api<{ state: string }>(`/core/tickets/${encodeURIComponent(command.ticket!)}/state`),
    refetchInterval: 5000,
    retry: false,
  });
  const send = async (optionId: string, change: boolean) => {
    setSending(true);
    onSendingChange?.(true);
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
      onAnswered();
    } catch {
      setError(true);
    } finally {
      setSending(false);
      onSendingChange?.(false);
    }
  };
  return (
    <section className="review-deck" aria-label={command.summary ?? command.title}>
      <p>{withoutLinks(command.question)}</p>
      <label>
        Note (optional)
        <textarea value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} />
      </label>
      <div className="worker-review-options" aria-label="Review options">
        {command.options.map((option, index) => (
          <div className="worker-review-option" key={option.id}>
            {option.playable ? (
              <PlayableCard gameId={commandSource(command)} card={option} options={command.options} />
            ) : option.media && mediaKindOf(option.media) === 'audio' ? (
              <audio controls src={option.media.url} aria-label={option.label} />
            ) : option.media && mediaKindOf(option.media) === 'video' ? (
              <video controls playsInline autoPlay muted loop src={option.media.url} className="review-deck-media" />
            ) : option.media ? (
              <button
                type="button"
                className="worker-review-image"
                onClick={() => setZoom({ url: option.media!.url, label: option.label })}
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
            <button disabled={sending || saved} type="button" onClick={() => void send(option.id, false)}>
              Pick {String.fromCharCode(65 + index)}: {withoutLinks(option.label)}
            </button>
          </div>
        ))}
      </div>
      <label>
        Option to change
        <select value={changeOption} onChange={(event) => setChangeOption(event.target.value)}>
          <option value="">Choose an option</option>
          {command.options.map((option, index) => (
            <option key={option.id} value={option.id}>
              {String.fromCharCode(65 + index)}: {withoutLinks(option.label)}
            </option>
          ))}
        </select>
      </label>
      <button
        disabled={sending || saved || !note.trim() || !command.options.some((option) => option.id === changeOption)}
        type="button"
        onClick={() => void send(changeOption, true)}
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
