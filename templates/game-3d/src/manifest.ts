import type { GameManifest } from '@ogm/contracts';

/* Read by the game and by vite.config.ts, which writes it to dist/manifest.json for publishing. */
export const manifest: GameManifest = {
  id: 'game-3d',
  sdk: '*',
  title: '3D Game',
  inputs: { actions: { move: 'stick', jump: 'button' } },
  presentation: { orientation: 'landscape', minLogical: { w: 640, h: 360 }, fit: 'responsive' },
  view: 'fixed',
  dimension: '3d',
  capabilities: ['editor.project'],
  palette: { categories: [], items: [] },
  tools: ['select', 'place'],
  gizmos: { spawn: ['translate'] },
  grid: { size: 1, units: 'm' },
  saves: true,
  overrides: { aliases: {}, retired: [] },
};
