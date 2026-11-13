import type { GameManifest } from '@ogm/contracts';

/* Read by the game and by vite.config.ts, which writes it to dist/manifest.json for publishing. */
export const manifest: GameManifest = {
  id: 'game-2d',
  sdk: '*',
  title: 'Grey-box Platformer',
  inputs: { actions: { move: 'axis', jump: 'button' } },
  presentation: { orientation: 'landscape', minLogical: { w: 640, h: 480 }, fit: 'fixed' },
  view: 'side',
  dimension: '2d',
  capabilities: ['editor.project'],
  palette: {
    categories: [{ id: 'level', label: 'Level', kind: 'items' }],
    items: [{ prefab: 'platform', label: 'Platform', category: 'level' }],
  },
  tools: ['select', 'place'],
  gizmos: { platform: ['translate'] },
  grid: { size: 16, units: 'px' },
  saves: true,
  overrides: { aliases: {}, retired: [] },
};
