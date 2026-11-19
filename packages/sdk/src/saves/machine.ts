import type { GameInstance, SaveData, SaveRevision } from '@ogm/contracts';

export type SaveState = 'idle' | 'pending_local' | 'saved_local' | 'saved_cloud' | 'conflict' | 'queued' | 'read_only';
export type SaveWriteReason = SaveRevision['reason'];
export type SaveWrite<S> = SaveData<S> & { reason: SaveWriteReason };
export type SaveGameInstance<S> = Pick<GameInstance<unknown, S>, 'serialize'> & { canSaveNow?(): boolean };

export interface SaveMachine<S> {
  markDirty(): void;
  pause(): void;
  checkpoint(): void;
  hidden(): void;
  interval(): void;
  restored(save: SaveData<S>): void;
  migrated(save: SaveData<S>): void;
  savedCloud(): void;
  conflict(): void;
  queued(): void;
  readOnly(): void;
  state(): SaveState;
  dispose(): void;
}

export function createSaveMachine<S>(options: {
  instance: SaveGameInstance<S>;
  send: (type: 'save.write', payload: SaveWrite<S>) => void;
  onState?: (state: SaveState) => void;
  intervalMs?: number;
  visibilityDocument?: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
  captureThumbnail?: () => string | undefined;
}): SaveMachine<S> {
  let currentState: SaveState = 'idle';
  let dirty = false;
  let disposed = false;
  let lastSafe = structuredClone(options.instance.serialize());

  const transition = (state: SaveState) => {
    currentState = state;
    options.onState?.(state);
  };
  const write = (reason: SaveWriteReason, supplied?: SaveData<S>) => {
    if (disposed || (!dirty && supplied === undefined)) return;
    let save = supplied;
    if (save === undefined) {
      if (options.instance.canSaveNow?.() === false) save = structuredClone(lastSafe);
      else {
        save = options.instance.serialize();
        const thumbnail = options.captureThumbnail?.();
        if (thumbnail) {
          const pictured = { ...save, thumbnail };
          // Leave room for the bridge envelope and do not make a previously valid large save too big.
          if (new TextEncoder().encode(JSON.stringify(pictured)).byteLength < 200_000) save = pictured;
        }
        lastSafe = structuredClone(save);
      }
    } else {
      lastSafe = structuredClone(save);
    }
    transition('pending_local');
    options.send('save.write', { ...structuredClone(save), reason });
    dirty = false;
    transition('saved_local');
  };

  const intervalId = setInterval(() => write('interval'), options.intervalMs ?? 30_000);
  const visibilityDocument = options.visibilityDocument ?? (typeof document === 'undefined' ? undefined : document);
  const onVisibility = () => {
    if (visibilityDocument?.visibilityState === 'hidden') write('hidden');
  };
  visibilityDocument?.addEventListener('visibilitychange', onVisibility);

  return {
    markDirty: () => {
      dirty = true;
    },
    pause: () => write('pause'),
    checkpoint: () => write('checkpoint'),
    hidden: () => write('hidden'),
    interval: () => write('interval'),
    restored: (save) => {
      lastSafe = structuredClone(save);
      dirty = false;
    },
    migrated: (save) => write('migration', save),
    savedCloud: () => transition('saved_cloud'),
    conflict: () => transition('conflict'),
    queued: () => transition('queued'),
    readOnly: () => transition('read_only'),
    state: () => currentState,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearInterval(intervalId);
      visibilityDocument?.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
