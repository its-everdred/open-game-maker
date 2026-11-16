import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { commandPath, commandSource, type ReviewCommand } from './review-command';
import { api } from '../../lib/api/client';
import { queryClient } from '../../app/query';
import { creatorCommandsQueryKey, gameCommandsQueryKey } from '../commands-inbox/commands';
import { mediaKindOf, withoutLinks } from '../commands-inbox/review';
import { PlayableCard } from '../commands-inbox/playable';

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
            : { review: { likes: [optionId], dislikes: [] } }),
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
      {command.options.map((option, index) => (
        <div className="worker-review-option" key={option.id}>
          {option.playable ? (
            <PlayableCard gameId={commandSource(command)} card={option} options={command.options} />
          ) : option.media && mediaKindOf(option.media) === 'audio' ? (
            <audio controls src={option.media.url} aria-label={option.label} />
          ) : option.media && mediaKindOf(option.media) === 'video' ? (
            <video controls playsInline src={option.media.url} className="review-deck-media" />
          ) : option.media ? (
            <img src={option.media.url} alt={option.label} className="review-deck-media" />
          ) : null}
          {option.audio && <audio controls src={option.audio.url} aria-label={`${option.label} audio`} />}
          <button disabled={sending || saved} type="button" onClick={() => void send(option.id, false)}>
            Pick {String.fromCharCode(65 + index)}: {withoutLinks(option.label)}
          </button>
        </div>
      ))}
      <label>
        Change this
        <textarea value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} />
      </label>
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
        disabled={sending || saved || !note.trim() || !changeOption}
        type="button"
        onClick={() => void send(changeOption, true)}
      >
        Send changes
      </button>
      {saved && (
        <p role="status">
          Saved · Ticket state: {('source' in command ? coreState.data?.state : ticketState) ?? 'updating'}
        </p>
      )}
      {error && <p role="alert">That answer did not send. Try again.</p>}
    </section>
  );
}
