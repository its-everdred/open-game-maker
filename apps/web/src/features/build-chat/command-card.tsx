import type { BuildChatMessage } from '@ogm/contracts';

import { AiBadge, withAiGeneratedLabel } from '../../components/AiBadge';
import './command-card.css';

export type CommandBudget = { used: number; max: 1 | 3 };

type CommandMessage = {
  id: string;
  command?: BuildChatMessage['command'];
};

export type CommandCardProps = {
  message: CommandMessage;
  mediaById?: (id: string) => Pick<BuildChatMessage, 'media'> | undefined;
  budget?: CommandBudget;
  busy?: boolean;
  onAnswer: (optionId: string) => void;
};

type Option = NonNullable<BuildChatMessage['command']>['options'][number];

function OptionContents({
  option,
  recommended,
  mediaById,
}: {
  option: Option;
  recommended: boolean;
  mediaById?: CommandCardProps['mediaById'];
}) {
  const media = option.media_id === undefined ? undefined : mediaById?.(option.media_id)?.media;
  return (
    <>
      {media && (
        <span className="command-option-media">
          {media.duration_ms === undefined ? (
            <img alt="" src={media.url} />
          ) : (
            <video muted playsInline poster={media.poster} preload="metadata" src={media.url} />
          )}
        </span>
      )}
      {option.aiGenerated ? <AiBadge /> : null}
      <span className="command-option-label">{option.label}</span>
      {recommended && <span className="command-recommended">Builder&apos;s pick</span>}
    </>
  );
}

export function CommandCard({ message, mediaById, budget, busy = false, onAnswer }: CommandCardProps) {
  const command = message.command;
  if (!command) return null;
  const options = [...command.options].sort(
    (left, right) => Number(right.id === command.recommend) - Number(left.id === command.recommend),
  );
  const linked = command.decision_id !== '';
  const showOptions = command.status !== 'moot';

  return (
    <article className={`build-chat-row command command-${command.status}`} aria-labelledby={`command-${message.id}`}>
      <strong id={`command-${message.id}`}>{command.question}</strong>
      {command.blocking && command.status === 'open' && <p className="command-note">The builder is waiting on this</p>}
      {command.status === 'moot' && <p className="command-state">No longer needed</p>}
      {command.status === 'open' && !linked && <p className="command-state">Waiting for the builder to ask</p>}
      {showOptions && (
        <div className="build-chat-options">
          {options.map((option) => {
            const recommended = option.id === command.recommend;
            if (command.status === 'open' && !linked) {
              return (
                <div className="build-chat-option" key={option.id} style={{ minHeight: '64px' }}>
                  <OptionContents option={option} recommended={recommended} mediaById={mediaById} />
                </div>
              );
            }
            const selected = command.status === 'answered' && option.id === command.option_id;
            return (
              <button
                aria-label={withAiGeneratedLabel(option.label, option.aiGenerated)}
                aria-pressed={selected}
                className="build-chat-option"
                disabled={busy || command.status !== 'open'}
                key={option.id}
                onClick={() => onAnswer(option.id)}
                style={{ minHeight: '64px' }}
                type="button"
              >
                <OptionContents option={option} recommended={recommended} mediaById={mediaById} />
              </button>
            );
          })}
        </div>
      )}
      {budget && (
        <p className="command-budget">
          Question {budget.used} of {budget.max}
        </p>
      )}
    </article>
  );
}
