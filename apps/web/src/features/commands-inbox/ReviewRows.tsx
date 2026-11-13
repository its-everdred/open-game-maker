import { Link } from 'react-router';
import type { ReactNode } from 'react';

import type { GameCommand } from '@ogm/contracts';

import { AiBadge, withAiGeneratedLabel } from '../../components/AiBadge';
import { Icon } from '../../components/Icon';
import { reviewTitle } from '../../routes/review/title';
import { draftState, useIsSent, useReviewDraft } from './drafts';
import { mediaKindOf, withoutLinks } from './review';
import './review-glass.css';

// The game's open questions as rows: each shows its first sample, a few words of title and whether it is open,
// started or sent. A tap opens the question's deck; the deck's arrows walk the same list.
export function ReviewRows({
  commands,
  hrefOf,
  actions,
}: {
  commands: readonly GameCommand[];
  hrefOf(command: GameCommand): string;
  actions?(command: GameCommand): ReactNode;
}) {
  return (
    <ul className="review-rows" aria-label="Reviews">
      {commands.map((command) => (
        <ReviewRow key={command.command_id} command={command} href={hrefOf(command)} actions={actions?.(command)} />
      ))}
    </ul>
  );
}

function ReviewRow({ command, href, actions }: { command: GameCommand; href: string; actions?: ReactNode }) {
  const sent = useIsSent(command);
  if (actions !== undefined && sent) return null;
  return (
    <li className="review-row">
      <ReviewRowLink command={command} href={href} />
      {actions}
    </li>
  );
}

// One question's row on its own, for a list that already holds it (the games spotlight's requests).
export function ReviewRowLink({ command, href }: { command: GameCommand; href: string }) {
  const draft = useReviewDraft(command);
  const state = draftState(draft);
  const title = reviewTitle(withoutLinks(command.title));
  const total = command.options.length;
  const done = total === 0 ? 0 : Math.min(draft.deck.cards.length, total) / total;
  const thumbnail = command.options.find((candidate) => candidate.media !== undefined);
  return (
    <Link
      aria-label={withAiGeneratedLabel(`${title}, ${state}`, thumbnail?.aiGenerated)}
      className="review-row-link"
      data-state={state}
      to={href}
    >
      <RowThumb command={command} />
      <span className="review-row-title">{title}</span>
      {state === 'sent' ? (
        <span className="review-row-mark" aria-hidden="true">
          <Icon name="thumbsUp" />
        </span>
      ) : (
        <svg className="review-row-progress" viewBox="0 0 28 28" aria-hidden="true">
          <circle cx="14" cy="14" r="12" />
          {done > 0 ? <circle cx="14" cy="14" r="12" pathLength={1} strokeDasharray={`${done} 1`} /> : null}
        </svg>
      )}
    </Link>
  );
}

// The question's first sample: a still, a clip's poster (or its first frame), a sound mark for a voice deck, nothing for a text question.
function RowThumb({ command }: { command: GameCommand }) {
  const option = command.options.find((candidate) => candidate.media !== undefined);
  const media = option?.media;
  const kind = media === undefined ? undefined : mediaKindOf(media);
  return (
    <span className="review-row-thumb">
      {media === undefined ? null : kind === 'audio' ? (
        <Icon name="soundOn" />
      ) : kind === 'video' && media.poster === undefined ? (
        <video muted playsInline preload="metadata" src={media.url} />
      ) : (
        <img alt="" src={media.poster ?? media.url} />
      )}
      {option?.aiGenerated ? <AiBadge /> : null}
    </span>
  );
}
