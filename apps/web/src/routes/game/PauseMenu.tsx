import type { Ref } from 'react';

import { Icon } from '../../components/Icon';
import { MenuRing } from '../../components/MenuCircle';

import './pause-menu.css';

type PauseMenuProps = {
  title: string;
  pauseName?: string;
  countdown?: number;
  muted: boolean;
  resumeRef: Ref<HTMLButtonElement>;
  editDisabled?: boolean;
  onResume(): void;
  onRestart?(): void;
  onLeave?(): void;
  onMute(muted: boolean): void;
  onSettings(): void;
  onEdit?(): void;
  onMore(): void;
};

/** The pause sheet the creator picked (option C): one big Resume, Restart and Leave side by side, then round icons. */
export function PauseMenu({
  title,
  pauseName,
  countdown,
  muted,
  resumeRef,
  editDisabled,
  onResume,
  onRestart,
  onLeave,
  onMute,
  onSettings,
  onEdit,
  onMore,
}: PauseMenuProps) {
  return (
    <div className="pause-menu">
      <h2>{title}</h2>
      {pauseName ? <p>Paused by {pauseName}</p> : null}
      {countdown !== undefined ? <p aria-live="polite">{countdown}</p> : null}
      <button
        ref={resumeRef}
        className="tap-primary pause-resume"
        type="button"
        onClick={onResume}
        disabled={countdown !== undefined}
      >
        <Icon name="play" />
        Resume
      </button>
      {onRestart || onLeave ? (
        <div className="pause-row">
          {onRestart ? (
            <button className="tap-secondary" type="button" onClick={onRestart}>
              <Icon name="replay" />
              Restart
            </button>
          ) : null}
          {onLeave ? (
            <button className="tap-secondary" type="button" onClick={onLeave}>
              <Icon name="signOut" />
              Leave
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="pause-icons">
        <button
          className="menu-circle"
          type="button"
          aria-label="Sound"
          aria-pressed={!muted}
          onClick={() => onMute(!muted)}
        >
          <MenuRing />
          <Icon name={muted ? 'volumeOff' : 'volume'} />
        </button>
        <button className="menu-circle" type="button" aria-label="Settings" onClick={onSettings}>
          <MenuRing />
          <Icon name="settings" />
        </button>
        {onEdit ? (
          <button className="menu-circle" type="button" aria-label="Edit" disabled={editDisabled} onClick={onEdit}>
            <MenuRing />
            <Icon name="edit" />
          </button>
        ) : null}
        <button className="menu-circle" type="button" aria-label="More" onClick={onMore}>
          <MenuRing />
          <Icon name="more" />
        </button>
      </div>
    </div>
  );
}
