import { useEffect, useRef, useState } from 'react';

import type {
  CreditsDocument,
  GameManifest,
  PlayerSettings,
  SaveData,
  SaveListQuery,
  SaveSlot,
} from '@ogm/contracts/browser';

import {
  getOptionalSaves,
  getSave,
  putSave,
  type OptionalCapability,
  type SaveContext,
} from '../../features/editor/api';
import type { GameFrameController } from '../../features/editor/frame';
import { handleGameEvent } from '../../features/editor/hud/achievements';
import {
  saveSlotLabel,
  saveSlotLoadable,
  saveSlotOptions,
  storeSaveWrite,
  type SaveSlotId,
  type SaveWrite,
} from '../../features/editor/hud/saves';
import { loadSettings, saveSettings } from '../../features/editor/hud/settings';
import { pushToast } from '../../lib/notify/slice';
import { Icon } from '../../components/Icon';
import { CreditsList } from '../settings/CreditsList';
import { getCredits } from '../settings/credits';
import { SharedSettings } from './SharedSettings';
import { assignableKey } from './control-keys';
import { PauseMenu } from './PauseMenu';

export type PlatformSaveApi = {
  list(gameId: string, query?: SaveListQuery): Promise<OptionalCapability<{ slots: SaveSlot[] }>>;
  read(gameId: string, slotId: SaveSlotId): Promise<SaveData<unknown>>;
  write: SaveWrite;
};

type PlatformHudProps = {
  build: 'draft' | 'published';
  frame: GameFrameController;
  gameId: string;
  actions?: GameManifest['inputs']['actions'];
  controlBindings?: GameManifest['controlBindings'];
  controlReservedKeys?: GameManifest['controlReservedKeys'];
  gameOptions?: GameManifest['gameOptions'];
  open?: boolean;
  /** The global game menu pauses solo play while it is open; room play remains live. */
  paused: boolean;
  pauseName?: string;
  resumeAt?: number;
  serverOffsetMs?: number;
  saveContext: SaveContext;
  saves: boolean;
  /** The running build's save schema; absent when the build did not report one. */
  saveSchema?: number;
  /** The one older schema the build still migrates; absent when it cannot migrate. */
  migratesFrom?: number;
  saveApi?: PlatformSaveApi;
  toast?: (message: string) => void;
  creditsApi?: (gameId: string, buildId: string) => Promise<CreditsDocument>;
  onLeave?(): void;
  /** Starts the game over from a fresh frame; absent in room play, where one player cannot restart the match. */
  onRestart?(): void;
  onEdit?(): void;
  editDisabled?: boolean;
  /** Receives the More page's container, where the studio menu shows the rest of the actions. */
  onMoreHost?(host: HTMLElement | null): void;
  onResume(): void;
};

const defaultSaveApi: PlatformSaveApi = { list: getOptionalSaves, read: getSave, write: putSave };
const defaultCreditsApi = (gameId: string, buildId: string) => getCredits(gameId, buildId);

function loadBindings(
  gameId: string,
  defaults: GameManifest['controlBindings'],
  reserved: readonly string[] = [],
): Record<string, string> {
  if (!defaults) return {};
  try {
    const value: unknown = JSON.parse(localStorage.getItem(`ogm.controls.${gameId}`) ?? 'null');
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ...defaults };
    const entries = Object.entries(value);
    const actions = Object.values(defaults).sort();
    if (
      entries.some(
        ([key, action]) => typeof action !== 'string' || (defaults[key] !== action && !assignableKey(key, reserved)),
      )
    )
      return { ...defaults };
    if (JSON.stringify(entries.map(([, action]) => action).sort()) !== JSON.stringify(actions)) return { ...defaults };
    return Object.fromEntries(entries) as Record<string, string>;
  } catch {
    return { ...defaults };
  }
}

function loadGameOptions(gameId: string, options: NonNullable<GameManifest['gameOptions']>) {
  let stored: unknown;
  try {
    stored = JSON.parse(localStorage.getItem(`ogm.game-options.${gameId}`) ?? '{}');
  } catch {
    stored = {};
  }
  return Object.fromEntries(
    options.map((option) => {
      const value =
        typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>)[option.id] : undefined;
      const valid =
        option.kind === 'toggle'
          ? typeof value === 'boolean'
          : option.kind === 'choice'
            ? typeof value === 'string' && option.choices.some((choice) => choice.value === value)
            : typeof value === 'number' &&
              Number.isFinite(value) &&
              value >= option.min &&
              value <= option.max &&
              Math.abs((value - option.min) / option.step - Math.round((value - option.min) / option.step)) < 1e-9;
      return [option.id, valid ? (value as boolean | string | number) : option.default];
    }),
  );
}

/** The list request facts for the running build; without its schema the API compares each slot with its own head. */
function listQuery(saveSchema: number | undefined, migratesFrom: number | undefined): SaveListQuery | undefined {
  if (saveSchema === undefined) return undefined;
  return migratesFrom === undefined ? { schema: saveSchema } : { schema: saveSchema, migratesFrom };
}

export function PlatformHud({
  build,
  frame,
  gameId,
  actions,
  controlBindings,
  controlReservedKeys,
  gameOptions,
  open,
  paused,
  pauseName,
  resumeAt,
  serverOffsetMs = 0,
  saveContext,
  saves,
  saveSchema,
  migratesFrom,
  saveApi = defaultSaveApi,
  toast = pushToast,
  creditsApi = defaultCreditsApi,
  onLeave,
  onRestart,
  onEdit,
  editDisabled,
  onMoreHost,
  onResume,
}: PlatformHudProps) {
  const visible = open ?? paused;
  const [slots, setSlots] = useState<SaveSlot[]>();
  const [savesAvailable, setSavesAvailable] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<SaveSlotId>('auto');
  const [settings, setSettings] = useState<PlayerSettings>(() => loadSettings());
  const [page, setPage] = useState<'pause' | 'settings' | 'more'>('pause');
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [optionValues, setOptionValues] = useState<Record<string, boolean | string | number>>(() =>
    loadGameOptions(gameId, gameOptions ?? []),
  );
  const [bindings, setBindings] = useState<Record<string, string>>(() =>
    loadBindings(gameId, controlBindings, controlReservedKeys),
  );
  const [credits, setCredits] = useState<CreditsDocument>();
  const [creditsFailed, setCreditsFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!resumeAt) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [resumeAt]);
  const resumeRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const slotsRef = useRef(slots);
  const selectedSlotRef = useRef(selectedSlot);
  const saveContextRef = useRef(saveContext);
  const saveQueueRef = useRef(Promise.resolve());
  slotsRef.current = slots;
  selectedSlotRef.current = selectedSlot;
  saveContextRef.current = saveContext;

  useEffect(() => {
    if (!saves) {
      setSavesAvailable(false);
      setSlots(undefined);
      return;
    }
    let active = true;
    void saveApi
      .list(gameId, listQuery(saveSchema, migratesFrom))
      .then((result) => {
        if (!active) return;
        setSavesAvailable(result.available);
        setSlots(result.available ? result.value.slots : undefined);
      })
      .catch(() => {
        if (active) toast('Saves unavailable');
      });
    return () => {
      active = false;
    };
  }, [gameId, migratesFrom, saveApi, saveSchema, saves, toast]);

  useEffect(() => {
    setOptionValues(loadGameOptions(gameId, gameOptions ?? []));
  }, [gameId, gameOptions]);

  useEffect(() => {
    setBindings(loadBindings(gameId, controlBindings, controlReservedKeys));
  }, [gameId, controlBindings, controlReservedKeys]);

  useEffect(() => {
    const normalized = saveSettings(settings);
    frame.setSettings({
      ...normalized,
      ...(gameOptions?.length ? { gameOptions: optionValues } : {}),
      ...(controlBindings ? { keyboardBindings: bindings } : {}),
    });
  }, [frame, settings, gameOptions, optionValues, controlBindings, bindings]);

  useEffect(() => {
    let active = true;
    const stopSave = frame.onSaveWrite((payload) => {
      if (!savesAvailable) return;
      saveQueueRef.current = saveQueueRef.current
        .then(async () => {
          try {
            await storeSaveWrite(
              gameId,
              selectedSlotRef.current,
              payload,
              slotsRef.current ?? [],
              saveApi.write,
              saveContextRef.current,
            );
          } finally {
            // A write whose response was lost may still have landed: reread the heads either way.
            const result = await saveApi.list(gameId, listQuery(saveSchema, migratesFrom));
            if (active) {
              setSavesAvailable(result.available);
              const nextSlots = result.available ? result.value.slots : undefined;
              slotsRef.current = nextSlots;
              setSlots(nextSlots);
            }
          }
        })
        .catch(() => toast('Save failed'));
    });
    const stopEvent = frame.onEvent((kind, payload) => handleGameEvent(kind, payload, build, toast));
    const stopLoadError = frame.onSaveLoadError(() => toast('Load failed'));
    return () => {
      active = false;
      stopSave();
      stopEvent();
      stopLoadError();
    };
  }, [build, frame, gameId, migratesFrom, saveApi, saveSchema, savesAvailable, toast]);

  useEffect(() => {
    if (visible) (page !== 'pause' ? backRef : resumeRef).current?.focus();
  }, [page, visible]);

  useEffect(() => {
    if (!visible) {
      setPage('pause');
      setCreditsOpen(false);
    }
  }, [visible]);

  useEffect(() => {
    if (!paused) return;
    frame.pause();
    return () => frame.resume();
  }, [frame, paused]);

  useEffect(() => {
    setCredits(undefined);
    setCreditsFailed(false);
  }, [gameId, saveContext.buildId]);

  useEffect(() => {
    if (!creditsOpen || credits !== undefined) return;
    let active = true;
    setCreditsFailed(false);
    void creditsApi(gameId, saveContext.buildId)
      .then((document) => {
        if (active) setCredits(document);
      })
      .catch(() => {
        if (active) setCreditsFailed(true);
      });
    return () => {
      active = false;
    };
  }, [credits, creditsApi, creditsOpen, gameId, saveContext.buildId]);

  const resume = () => {
    onResume();
  };
  const load = async () => {
    const slot = slots?.find((candidate) => candidate.slotId === selectedSlot);
    if (!saveSlotLoadable(slot)) return;
    try {
      frame.restoreSave(await saveApi.read(gameId, selectedSlot));
      resume();
    } catch {
      toast('Load failed');
    }
  };

  return (
    <div className="platform-hud">
      {visible ? (
        <div className="platform-pause-shade" data-gm-overlay-allowed>
          <div
            className="platform-pause-dialog"
            data-studio-menu-boundary
            role="dialog"
            aria-modal="true"
            aria-label={page === 'pause' ? (paused ? 'Paused' : 'Game menu') : page === 'more' ? 'More' : 'Settings'}
          >
            {page === 'settings' ? (
              <SharedSettings
                settings={settings}
                onChange={setSettings}
                actions={actions ?? {}}
                bindings={controlBindings ? bindings : undefined}
                reservedKeys={controlReservedKeys}
                onBindingsChange={(next) => {
                  setBindings(next);
                  try {
                    localStorage.setItem(`ogm.controls.${gameId}`, JSON.stringify(next));
                  } catch {
                    /* Storage is optional. */
                  }
                }}
                onResetBindings={() => {
                  const next = { ...controlBindings };
                  setBindings(next);
                  try {
                    localStorage.removeItem(`ogm.controls.${gameId}`);
                  } catch {
                    /* Storage is optional. */
                  }
                }}
                options={gameOptions ?? []}
                gameOptions={optionValues}
                onGameOptionsChange={(values) => {
                  setOptionValues(values);
                  try {
                    localStorage.setItem(`ogm.game-options.${gameId}`, JSON.stringify(values));
                  } catch {
                    /* Storage is optional. */
                  }
                }}
                backRef={backRef}
                onBack={() => {
                  setPage('pause');
                  setCreditsOpen(false);
                }}
              >
                {savesAvailable && slots !== undefined ? (
                  <details>
                    <summary>
                      <Icon name="publish" />
                      Saves
                    </summary>
                    <div className="shared-settings-content save-slots" role="group" aria-label="Save slots">
                      {saveSlotOptions(slots).map(({ id, slot }) => (
                        <button
                          className="tap-secondary"
                          type="button"
                          key={id}
                          aria-pressed={selectedSlot === id}
                          onClick={() => setSelectedSlot(id)}
                        >
                          {slot?.label ?? saveSlotLabel(id)}
                        </button>
                      ))}
                      <button
                        className="tap-secondary"
                        type="button"
                        disabled={!saveSlotLoadable(slots.find((slot) => slot.slotId === selectedSlot))}
                        onClick={() => void load()}
                      >
                        Load
                      </button>
                    </div>
                  </details>
                ) : null}
                <details onToggle={(event) => setCreditsOpen(event.currentTarget.open)}>
                  <summary>
                    <Icon name="credits" />
                    Credits
                  </summary>
                  <div className="shared-settings-content">
                    {credits === undefined && !creditsFailed ? <p>Loading…</p> : null}
                    {creditsFailed ? <p role="alert">Unavailable</p> : null}
                    {credits ? <CreditsList packs={credits.packs} /> : null}
                  </div>
                </details>
              </SharedSettings>
            ) : page === 'more' ? (
              <div className="pause-more">
                <button
                  ref={backRef}
                  type="button"
                  className="shared-settings-back"
                  aria-label="Back"
                  onClick={() => setPage('pause')}
                >
                  <Icon name="close" />
                </button>
                <div ref={onMoreHost} className="pause-more-host" />
              </div>
            ) : (
              <PauseMenu
                title={paused ? 'Paused' : 'Game menu'}
                pauseName={pauseName}
                countdown={resumeAt ? Math.max(1, Math.ceil((resumeAt - (now + serverOffsetMs)) / 1000)) : undefined}
                muted={settings.mute}
                resumeRef={resumeRef}
                editDisabled={editDisabled}
                onResume={resume}
                onRestart={onRestart}
                onLeave={onLeave}
                onMute={(mute) => setSettings((current) => ({ ...current, mute }))}
                onSettings={() => setPage('settings')}
                onEdit={onEdit}
                onMore={() => setPage('more')}
              />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
