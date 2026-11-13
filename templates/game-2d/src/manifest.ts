import type { GameManifest } from '@ogm/contracts';
import { paintedSceneryControls } from '@gm/sdk/scenery';

declare const __GM_SCENERY_ITEMS__: GameManifest['palette']['items'] | undefined;
const sceneryItems = typeof __GM_SCENERY_ITEMS__ === 'undefined' ? [] : __GM_SCENERY_ITEMS__;

/* Read by the game and by vite.config.ts, which writes it to dist/manifest.json for publishing. */
export const manifest: GameManifest = {
  id: 'game-2d',
  sdk: '*',
  title: 'Grey-box Platformer',
  inputs: { actions: { move: 'axis', jump: 'button' } },
  presentation: { orientation: 'landscape', minLogical: { w: 640, h: 480 }, fit: 'fixed' },
  view: 'side',
  dimension: '2d',
  capabilities: ['scenery', 'editor.project'],
  controls: paintedSceneryControls,
  palette: {
    categories: [
      { id: 'level', label: 'Level', kind: 'items' },
      { id: 'sprites', label: 'Items', kind: 'items' },
    ],
    items: [{ prefab: 'platform', label: 'Platform', category: 'level' }, ...sceneryItems],
  },
  tools: ['select', 'place'],
  gizmos: { platform: ['translate'], ...Object.fromEntries(sceneryItems.map((item) => [item.prefab, ['translate']])) },
  grid: { size: 16, units: 'px' },
  saves: true,
  overrides: { aliases: {}, retired: [] },
};
