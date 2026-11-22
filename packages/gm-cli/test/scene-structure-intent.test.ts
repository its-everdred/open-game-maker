import { expect, it } from 'vitest';
import { sceneStructureIntent } from '../src/scene/structure-intent.js';

it('preserves a gate, chapel and path without inventing unregistered cells or sprite choices', () => {
  const brief = {
    image: { width: 10, height: 10 },
    story: 'A chapel beyond a gate.',
    mood: 'Dusk',
    light: 'Warm',
    focalRegion: 'chapel',
    regions: [
      { id: 'perimeter', label: 'Perimeter', layer: 'background', bounds: { x: 0, y: 0, width: 10, height: 10 } },
      { id: 'chapel', label: 'Chapel', layer: 'landmark', bounds: { x: 2, y: 0, width: 6, height: 5 } },
      { id: 'yard', label: 'Yard', layer: 'ground', bounds: { x: 0, y: 4, width: 10, height: 6 } },
    ],
  };
  const intent = {
    mockSha256: 'a'.repeat(64),
    grid: null,
    anchors: [
      { id: 'gate', region: 'perimeter', role: 'gate', cell: null, facing: null },
      { id: 'door', region: 'chapel', role: 'door', cell: null, facing: null },
    ],
    structures: [
      { id: 'fence', region: 'perimeter', kind: 'edge-run', cells: null, openings: ['gate'] },
      { id: 'building', region: 'chapel', kind: 'building', footprint: null, door: 'door' },
      { id: 'approach', region: 'yard', kind: 'path', cells: null, from: 'gate', to: 'door' },
    ],
  };
  expect(sceneStructureIntent(brief, intent)).toEqual(intent);
  expect(() =>
    sceneStructureIntent(brief, {
      ...intent,
      anchors: [{ ...intent.anchors[0], cell: { x: 1, y: 1 } }, intent.anchors[1]],
    }),
  ).toThrow('no valid grid');
  expect(() =>
    sceneStructureIntent(brief, { ...intent, structures: [{ ...intent.structures[1], door: 'gate' }] }),
  ).toThrow('invalid door');
  const gridIntent = {
    ...intent,
    grid: { width: 4, height: 4 },
    anchors: [
      { ...intent.anchors[0], cell: { x: 0, y: 0 } },
      { ...intent.anchors[1], cell: { x: 2, y: 0 } },
    ],
    structures: [
      {
        id: 'approach',
        region: 'yard',
        kind: 'path',
        from: 'gate',
        to: 'door',
        cells: [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
        ],
      },
    ],
  };
  expect(() => sceneStructureIntent(brief, gridIntent)).toThrow('disconnected');
  gridIntent.structures[0]!.cells.splice(1, 0, { x: 1, y: 0 });
  expect(sceneStructureIntent(brief, gridIntent).structures[0]).toMatchObject({
    kind: 'path',
    cells: gridIntent.structures[0]!.cells,
  });
});
