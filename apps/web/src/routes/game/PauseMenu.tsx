import type { Ref } from 'react';

import { Icon } from '../../components/Icon';
import '../../features/game-menu/game-menu.css';
import './pause-menu.css';

type PauseMenuProps = {
  title: string;
  pauseName?: string;
  countdown?: number;
  muted: boolean;
  /** 0–1, the player's game volume. */
  volume: number;
  resumeRef: Ref<HTMLButtonElement>;
  editDisabled?: boolean;
  onResume(): void;
  onRestart?(): void;
  onLeave?(): void;
  onMute(muted: boolean): void;
  onVolume(volume: number): void;
  onBug?(): void;
  onSettings(): void;
  onEdit?(): void;
  onMore?(): void;
};

/**
 * The play menu (#1326, Claude Design "Editor + Play Menus"): Resume, Restart and Leave, then sound and File a bug.
 * Settings, Edit and the game's own extras stay as quiet circles under them.
 */
export function PauseMenu({
  title,
  pauseName,
  countdown,
  muted,
  volume,
  resumeRef,
  editDisabled,
  onResume,
  onRestart,
  onLeave,
  onMute,
  onVolume,
  onBug,
  onSettings,
  onEdit,
  onMore,
}: PauseMenuProps) {
  return (
    <>
      <div className="game-menu-head is-center">
        <h2>{title}</h2>
      </div>
      {pauseName || countdown !== undefined ? (
        <div className="pause-menu-note">
          {pauseName ? <p>Paused by {pauseName}</p> : null}
          {countdown !== undefined ? <p aria-live="polite">{countdown}</p> : null}
        </div>
      ) : null}
      <div className="game-menu-body is-play">
        <div className="game-menu-sec" style={{ gridArea: 'a' }}>
          <button
            ref={resumeRef}
            className="game-menu-big is-go"
            type="button"
            onClick={onResume}
            disabled={countdown !== undefined}
          >
            <Icon name="play" className="is-solid" />
            Resume
          </button>
          {onRestart ? (
            <button className="game-menu-big" type="button" onClick={onRestart}>
              <Icon name="replay" />
              Restart
            </button>
          ) : null}
          {onLeave ? (
            <button className="game-menu-big" type="button" onClick={onLeave}>
              <Icon name="signOut" />
              Leave
            </button>
          ) : null}
        </div>
        <div className="game-menu-sec" style={{ gridArea: 'b' }}>
          <div className="game-menu-sound">
            <button
              className="game-menu-circle"
              type="button"
              aria-label={muted ? 'Unmute' : 'Mute'}
              onClick={() => onMute(!muted)}
            >
              <Icon name={muted ? 'volumeOff' : 'volume'} />
            </button>
            <input
              type="range"
              min="0"
              max="100"
              aria-label="Volume"
              value={muted ? 0 : Math.round(volume * 100)}
              onChange={(event) => {
                const next = Number(event.target.value) / 100;
                onVolume(next);
                if (muted && next > 0) onMute(false);
              }}
            />
          </div>
          {onBug ? (
            <button className="game-menu-big" type="button" onClick={onBug}>
              <Icon name="bug" />
              File a bug
            </button>
          ) : null}
          <div className="game-menu-quiet">
            <button className="game-menu-circle" type="button" aria-label="Settings" onClick={onSettings}>
              <Icon name="settings" />
            </button>
            {onEdit ? (
              <button
                className="game-menu-circle"
                type="button"
                aria-label="Edit"
                disabled={editDisabled}
                onClick={onEdit}
              >
                <Icon name="edit" />
              </button>
            ) : null}
            {onMore ? (
              <button className="game-menu-circle" type="button" aria-label="More" onClick={onMore}>
                <Icon name="more" />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
