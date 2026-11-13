import type { CSSProperties } from 'react';
import { Icon } from '../../components/Icon';

const ICON_ALIASES: Record<string, string> = {
  space: 'spaceW',
  single: 'solo',
  multi: 'party',
  fixed: 'strategy',
  follow: 'racing',
  fps: 'shooter',
  orbit: 'spaceW',
  side: 'platformer',
  topdown: 'strategy',
};

export function OptionTile({
  id,
  label,
  pressed,
  limitFeedback = 0,
  onToggle,
}: {
  id: string;
  label: string;
  pressed: boolean;
  limitFeedback?: number;
  onToggle(): void;
}) {
  const icon = ICON_ALIASES[id] ?? id;
  return (
    <button
      className={`new-option tap-primary${pressed && limitFeedback ? ' new-limit-shake' : ''}`}
      type="button"
      aria-pressed={pressed}
      data-limit-feedback={pressed && limitFeedback ? limitFeedback % 2 : undefined}
      style={{ '--option-color': `var(--option-${icon}, var(--new-color))` } as CSSProperties}
      onClick={onToggle}
    >
      <Icon name={icon} className="new-option-icon" />
      <span>{label}</span>
    </button>
  );
}
