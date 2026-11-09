import type { GameCommand } from '@ogm/contracts';

import { mediaKindOf, withoutLinks } from './review';

// A Command's options as tap targets: the game's inbox and the menu's decision deck answer a Command without media
// the same way.
export function CommandOptions({
  command,
  disabled,
  onAnswer,
}: {
  command: GameCommand;
  disabled: boolean;
  onAnswer(optionId: string): void;
}) {
  return (
    <div className="build-chat-options">
      {command.options.map((option) => (
        <button
          aria-label={withoutLinks(option.label)}
          className="build-chat-option"
          disabled={disabled}
          key={option.id}
          onClick={() => onAnswer(option.id)}
          type="button"
        >
          {option.media && (
            <span className="command-option-media" aria-hidden="true">
              {mediaKindOf(option.media) === 'image' ? (
                <img alt="" src={option.media.url} />
              ) : (
                <video muted playsInline poster={option.media.poster} preload="metadata" src={option.media.url} />
              )}
            </span>
          )}
          <span className="command-option-label">{withoutLinks(option.label)}</span>
          {option.id === command.recommend && <span className="command-recommended">Builder&apos;s pick</span>}
        </button>
      ))}
    </div>
  );
}
