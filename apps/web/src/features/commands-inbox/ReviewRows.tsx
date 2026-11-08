import { Link } from 'react-router';

import type { GameCommand } from '@ogm/contracts';

import { Icon } from '../../components/Icon';
import { reviewTitle } from '../../routes/review/title';
import { draftState, useReviewDraft } from './drafts';
import { mediaKindOf } from './review';
import './review-glass.css';

// The game's open questions as rows: each shows its first sample, a few words of title and whether it is open,
// started or sent. A tap opens the question's deck; the deck's arrows walk the same list.
export function ReviewRows({
  commands,
  hrefOf,
}: {
  commands: readonly GameCommand[];
  hrefOf(command: GameCommand): string;
}) {
  return (
    <ul className="review-rows" aria-label="Reviews">
      {commands.map((command) => (
        <ReviewRow key={command.checkpoint_id} command={command} href={hrefOf(command)} />
      ))}
    </ul>
  );
}

function ReviewRow({ command, href }: { command: GameCommand; href: string }) {
  const draft = useReviewDraft(command);
  const state = draftState(draft);
  const title = reviewTitle(command.title);
  const total = command.options.length;
  const done = total === 0 ? 0 : Math.min(draft.deck.cards.length, total) / total;
  return (
    <li className="review-row" data-state={state}>
      <Link aria-label={`${title}, ${state}`} className="review-row-link" to={href}>
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
    </li>
  );
}

// The question's first sample: a still or a clip's poster, a sound mark for a voice deck, nothing for a text question.
function RowThumb({ command }: { command: GameCommand }) {
  const media = command.options.find((option) => option.media !== undefined)?.media;
  const kind = media === undefined ? undefined : mediaKindOf(media);
  return (
    <span className="review-row-thumb" aria-hidden="true">
      {media === undefined ? null : kind === 'audio' ? (
        <Icon name="soundOn" />
      ) : (
        <img alt="" src={media.poster ?? media.url} />
      )}
    </span>
  );
}
