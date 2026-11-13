import type { ControlDecl, GameManifest } from '@ogm/contracts';
import { sceneryPalette } from '@gm/sdk/scenery';

declare const __GM_SCENERY_PALETTE__: GameManifest['palette'] | undefined;
const palette = typeof __GM_SCENERY_PALETTE__ === 'undefined' ? sceneryPalette([], []) : __GM_SCENERY_PALETTE__;

export const scenerySettingsControl: ControlDecl = {
  id: 'scenery.lighting',
  label: 'Scenery light',
  scope: 'global',
  path: '/globals/scenery.lighting',
  widget: {
    kind: 'choice',
    options: [
      { value: 'warm-forest', label: 'Warm forest' },
      { value: 'night', label: 'Night' },
      { value: 'cave', label: 'Cave' },
    ],
  },
  default: 'warm-forest',
};

/* Read by the game and by vite.config.ts, which writes it to dist/manifest.json for publishing. */
export const manifest: GameManifest = {
  id: 'game-3d',
  sdk: '*',
  title: '3D Game',
  inputs: { actions: { move: 'stick', jump: 'button' } },
  presentation: { orientation: 'landscape', minLogical: { w: 640, h: 360 }, fit: 'responsive' },
  view: 'fixed',
  dimension: '3d',
  capabilities: ['editor.project', 'scenery'],
  controls: [scenerySettingsControl],
  palette,
  tools: ['select', 'place'],
  gizmos: {
    spawn: ['translate'],
    ...Object.fromEntries(palette.items.map((item) => [item.prefab, ['translate', 'rotateYaw']])),
  },
  grid: { size: 1, units: 'm' },
  saves: true,
  overrides: { aliases: {}, retired: [] },
};
