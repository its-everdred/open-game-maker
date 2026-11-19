import type { GameManifest } from '@ogm/contracts/browser';
import type { AwaySnapshot } from './away-pause';

import { getOptionalSaves, getSave } from '../../features/editor/api';
import { saveSlotLoadable } from '../../features/editor/hud/saves';
import { pushToast } from '../../lib/notify/slice';

export function saveOptions(
  gameId: string,
  room: { current: string | undefined },
  menu: { current: boolean },
  away?: AwaySnapshot,
  awayHold?: { current: boolean },
) {
  return {
    startupRestore: async (manifest: GameManifest) => {
      if (!manifest.saves || room.current !== undefined) return undefined;
      if (away?.save) return away.save;
      const query =
        manifest.saveSchema === undefined
          ? undefined
          : {
              schema: manifest.saveSchema,
              ...(manifest.migratesFrom === undefined ? {} : { migratesFrom: manifest.migratesFrom }),
            };
      const result = await getOptionalSaves(gameId, query);
      if (!result.available) throw new Error('saves unavailable');
      const slot = result.value.slots.find((candidate) => candidate.slotId === 'auto');
      if (!slot) return undefined;
      if (!saveSlotLoadable(slot)) throw new Error('save incompatible');
      const save = await getSave(gameId, 'auto');
      return room.current === undefined ? save : undefined;
    },
    onStartupRestoreError: () => pushToast('Could not restore save; saving is off'),
    resumeAfterStartup: () => !awayHold?.current && !menu.current && document.visibilityState !== 'hidden',
  };
}
