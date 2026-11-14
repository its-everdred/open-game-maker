import { useState, type Ref } from 'react';
import { resetReviewDrafts } from '../../features/commands-inbox/drafts';
import { signOut } from '../../lib/api/auth';
import { Icon } from '../../components/Icon';
import { assignableKey } from './control-keys';
import { snapOptionNumber } from './option-number';
import type { GameManifest, PlayerSettings } from '@ogm/contracts/browser';

import './shared-settings.css';

type Props = {
  settings: PlayerSettings;
  onChange(settings: PlayerSettings): void;
  actions: GameManifest['inputs']['actions'];
  bindings?: Record<string, string>;
  reservedKeys?: string[];
  onBindingsChange?(bindings: Record<string, string>): void;
  onResetBindings?(): void;
  options: NonNullable<GameManifest['gameOptions']>;
  gameOptions: Record<string, boolean | string | number>;
  onGameOptionsChange(options: Record<string, boolean | string | number>): void;
  onBack?(): void;
  backRef?: Ref<HTMLButtonElement>;
};

export function SharedSettings({
  settings,
  onChange,
  actions,
  bindings,
  reservedKeys,
  onBindingsChange,
  onResetBindings,
  options,
  gameOptions,
  onGameOptionsChange,
  onBack,
  backRef,
}: Props) {
  const [signOutFailed, setSignOutFailed] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [capturing, setCapturing] = useState<string>();
  const leaveAccount = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
      resetReviewDrafts();
    } catch {
      setSignOutFailed(true);
      setSigningOut(false);
    }
  };
  const update = (patch: Partial<PlayerSettings>) => onChange({ ...settings, ...patch });
  return (
    <div className="shared-settings">
      <header className="shared-settings-header">
        <span aria-hidden="true" className="shared-settings-gear">
          ⚙
        </span>
        <h2>
          <span>Game Maker</span>Settings
        </h2>
        {onBack ? (
          <button ref={backRef} type="button" className="shared-settings-back" aria-label="Back" onClick={onBack}>
            <Icon name="close" />
          </button>
        ) : null}
      </header>
      <details open>
        <summary>
          <Icon name="volume" />
          Sound
        </summary>
        <div className="shared-settings-content">
          <label>
            Sound{' '}
            <input
              aria-label="Sound volume"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={settings.volume}
              onChange={(e) => update({ volume: e.currentTarget.valueAsNumber })}
            />
          </label>
          <label>
            Music{' '}
            <input
              aria-label="Music volume"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={settings.musicVolume ?? 1}
              onChange={(e) => update({ musicVolume: e.currentTarget.valueAsNumber })}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.mute}
              onChange={(e) => update({ mute: e.currentTarget.checked })}
            />{' '}
            Mute
          </label>
        </div>
      </details>
      <details>
        <summary>
          <Icon name="versus" />
          Controls
        </summary>
        <div className="shared-settings-content">
          {bindings && Object.keys(bindings).length ? (
            <>
              {Object.entries(bindings)
                .filter(([code]) => code !== 'Escape')
                .map(([code, action], index) => (
                  <div key={`${action}-${index}`} className="shared-binding">
                    <span>{action}</span>
                    <button
                      type="button"
                      className="tap-secondary"
                      aria-label={`${action}: ${capturing === code ? 'press a key' : code}`}
                      onClick={() => setCapturing(code)}
                      onBlur={() => setCapturing(undefined)}
                      onKeyDown={(event) => {
                        if (capturing !== code) return;
                        if (event.key === 'Tab') {
                          setCapturing(undefined);
                          return;
                        }
                        event.preventDefault();
                        event.stopPropagation();
                        const nextCode = event.code;
                        if (nextCode === 'Escape') {
                          setCapturing(undefined);
                          return;
                        }
                        if (
                          !nextCode ||
                          !assignableKey(nextCode, reservedKeys) ||
                          event.ctrlKey ||
                          event.altKey ||
                          event.metaKey ||
                          event.shiftKey ||
                          nextCode.length > 64 ||
                          (nextCode !== code && nextCode in bindings)
                        )
                          return;
                        const next = Object.fromEntries(
                          Object.entries(bindings).map(([key, value]) => [key === code ? nextCode : key, value]),
                        );
                        setCapturing(undefined);
                        onBindingsChange?.(next);
                      }}
                    >
                      {capturing === code ? 'Press a key' : code}
                    </button>
                  </div>
                ))}
              <button type="button" className="tap-secondary" onClick={onResetBindings}>
                Reset controls
              </button>
            </>
          ) : Object.keys(actions).length ? (
            <p>Controls are set by this game.</p>
          ) : (
            <p>No controls listed</p>
          )}
        </div>
      </details>
      <details>
        <summary>
          <Icon name="solo" />
          Accessibility
        </summary>
        <div className="shared-settings-content">
          <label>
            Text size{' '}
            <input
              aria-label="Text size"
              type="range"
              min="0.75"
              max="2"
              step="0.05"
              value={settings.textScale}
              onChange={(e) => update({ textScale: e.currentTarget.valueAsNumber })}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.reduceMotion}
              onChange={(e) => update({ reduceMotion: e.currentTarget.checked })}
            />{' '}
            Reduce motion
          </label>
        </div>
      </details>
      <details>
        <summary>
          <Icon name="admin" />
          Account
        </summary>
        <div className="shared-settings-content">
          <button type="button" className="tap-secondary" disabled={signingOut} onClick={() => void leaveAccount()}>
            Sign out
          </button>
          {signOutFailed ? <p role="alert">Could not sign out</p> : null}
        </div>
      </details>
      {options.length ? (
        <details>
          <summary>
            <Icon name="build" />
            Game options
          </summary>
          <div className="shared-settings-content">
            {options.map((option) => (
              <label key={option.id}>
                {option.kind === 'toggle' ? (
                  <input
                    type="checkbox"
                    checked={
                      typeof gameOptions[option.id] === 'boolean' ? (gameOptions[option.id] as boolean) : option.default
                    }
                    onChange={(e) => onGameOptionsChange({ ...gameOptions, [option.id]: e.currentTarget.checked })}
                  />
                ) : option.kind === 'choice' ? (
                  <select
                    aria-label={option.label}
                    value={String(gameOptions[option.id] ?? option.default)}
                    onChange={(e) => onGameOptionsChange({ ...gameOptions, [option.id]: e.currentTarget.value })}
                  >
                    {option.choices.map((choice) => (
                      <option key={choice.value} value={choice.value}>
                        {choice.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <>
                    <input
                      aria-label={option.label}
                      type="range"
                      min={option.min}
                      max={option.max}
                      step={option.step}
                      value={Number(gameOptions[option.id] ?? option.default)}
                      onChange={(e) => {
                        const value = e.currentTarget.valueAsNumber;
                        if (Number.isFinite(value))
                          onGameOptionsChange({
                            ...gameOptions,
                            [option.id]: snapOptionNumber(value, option.min, option.max, option.step),
                          });
                      }}
                    />
                    <output>{Number(gameOptions[option.id] ?? option.default)}</output>
                  </>
                )}{' '}
                {option.label}
              </label>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
