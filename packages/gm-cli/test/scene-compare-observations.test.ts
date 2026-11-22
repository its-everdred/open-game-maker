import { expect, it } from 'vitest';
import { compareSceneObservations, type SceneObservation } from '../src/scene/compare-observations.js';

it('ranks explicit scene discrepancies and keeps missing evidence separate', () => {
  const expected: SceneObservation[] = [
    { id: 'chapel', region: 'entrance', presence: 'present', facing: 'S', scaleInCharacters: 4, connected: true },
    { id: 'path', region: 'yard', presence: 'present', connected: true },
    { id: 'growth', region: 'yard', presence: 'present', density: 0.8 },
    { id: 'torch', region: 'gate', presence: 'present' },
    { id: 'tree', region: 'gate', presence: 'present', facing: 'W' },
  ];
  const actual: SceneObservation[] = [
    { id: 'chapel', region: 'entrance', presence: 'present', facing: 'E', scaleInCharacters: 2, connected: false },
    { id: 'path', region: 'yard', presence: 'present', connected: false },
    { id: 'growth', region: 'yard', presence: 'present', density: 0.2 },
    { id: 'torch', region: 'gate', presence: 'absent' },
    { id: 'tree', region: 'gate', presence: 'present' },
  ];
  const result = compareSceneObservations(expected, actual, { scaleFraction: 0.1, densityFraction: 0.2 });
  expect(result.discrepancies.map(({ id, kind }) => `${id}:${kind}`)).toEqual([
    'torch:missing',
    'chapel:broken-structure',
    'path:broken-structure',
    'chapel:facing',
    'chapel:scale',
    'growth:sparse-dressing',
  ]);
  expect(result.unobserved).toEqual(['tree.facing']);
  expect(compareSceneObservations(expected, [], { scaleFraction: 0.1, densityFraction: 0.2 }).discrepancies).toEqual(
    [],
  );
  expect(() =>
    compareSceneObservations(expected, [...actual, actual[0]!], { scaleFraction: 0.1, densityFraction: 0.2 }),
  ).toThrow('duplicate');
  expect(() => compareSceneObservations(expected, actual, { scaleFraction: -1, densityFraction: 0.2 })).toThrow(
    'tolerance',
  );
});
