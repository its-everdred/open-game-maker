import { boot } from '@gm/sdk/core';
import { createMenu } from '@gm/sdk/menu';
import type { GameManifest, GameModule } from '@ogm/contracts/game';
import { z } from 'zod';

declare global {
  interface Window {
    __started: boolean;
  }
}

// Dusk Helm's action shape: one stick, then the buttons the host draws and binds to a pad's a, x, b.
const manifest: GameManifest = {
  id: 'menu-fixture',
  sdk: '^1.0.0',
  title: 'Menu Fixture',
  inputs: { actions: { move: 'stick', attack: 'button', block: 'button', charge: 'button' } },
  presentation: { orientation: 'any', minLogical: { w: 360, h: 640 }, fit: 'responsive' },
  view: 'topdown',
  dimension: '2d',
  capabilities: [],
  palette: { categories: [], items: [] },
  tools: [],
  gizmos: {},
  saves: false,
  overrides: { aliases: {}, retired: [] },
};

const game: GameModule<Record<string, never>, Record<string, never>> = {
  manifest,
  designSchema: z.object({}),
  controls: [],
  async mount() {
    return {
      pause() {},
      resume() {},
      dispose() {},
      applyDesign: () => 'live',
      serialize: () => ({ saveSchemaVersion: 1, data: {} }),
      restore() {},
      net: {
        spawn() {},
        despawn() {},
        snapshot: () => ({ tick: 0, state: {} }),
        applySnapshot() {},
        hud: () => ({}),
      },
    };
  },
};

window.__started = false;
await boot(game, { hostOrigin: 'http://127.0.0.1:4173' });
const title = document.querySelector<HTMLElement>('#title')!;
const menu = createMenu({ root: title });
title.querySelector('#play')!.addEventListener('click', () => {
  window.__started = true;
  menu.dispose();
  title.hidden = true;
});
