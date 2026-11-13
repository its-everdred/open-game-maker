import type { ReactNode } from 'react';

import { EDITOR_FOCUS_ZONES } from '../../features/editor/focus';
import { FocusZone } from '../../lib/input';

type PlayEditBarProps = {
  title: string;
  mode: 'play' | 'edit';
  saved?: string;
  build: 'draft' | 'published';
  playLabel?: string;
  compact?: boolean;
  children?: ReactNode;
  onBack(): void;
  onMode(mode: 'play' | 'edit'): void;
  onAsk(): void;
};

export function PlayEditBar({
  title,
  mode,
  saved,
  build,
  playLabel = 'Play',
  compact = false,
  children,
  onBack,
  onMode,
  onAsk,
}: PlayEditBarProps) {
  return (
    <FocusZone id={EDITOR_FOCUS_ZONES.bar} className="play-bar">
      <button className="back tap-primary" type="button" onClick={onBack}>
        Games
      </button>
      <span className="play-title">{title}</span>
      {saved ? <output className="saved-state">{saved}</output> : null}
      <span className="build-badge">{build === 'draft' ? 'Draft' : 'Published'}</span>
      <div className="mode-segment" role="group" aria-label="Mode">
        <button
          className="tap-primary"
          type="button"
          data-mode="play"
          aria-label={compact ? playLabel : undefined}
          aria-pressed={mode === 'play'}
          onClick={() => onMode('play')}
        >
          ▶ {playLabel}
        </button>
        <button
          className="tap-primary"
          type="button"
          data-mode="edit"
          aria-pressed={mode === 'edit'}
          onClick={() => onMode('edit')}
        >
          ✎ Edit
        </button>
      </div>
      <button className="ask-change tap-primary" type="button" onClick={onAsk}>
        <span className="ask-change-icon" aria-hidden="true" /> Ask for a change
      </button>
      {children}
    </FocusZone>
  );
}
