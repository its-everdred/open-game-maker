import { expect, it } from 'vitest';
import { buildingLayout } from '../src/building-layout.js';

it('covers the footprint and leaves a walkable exterior entry at the door', () => {
  const footprint = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
  ];
  const door = { cell: footprint[0]!, edge: 'yMin' as const };
  const layout = buildingLayout(footprint, door, [{ x: 0, y: -1 }]);
  expect(layout.roof).toEqual(footprint);
  expect(layout.walls).toHaveLength(7);
  expect(layout.walls).not.toContainEqual(door);
  expect(layout.entry).toEqual({ x: 0, y: -1 });
  expect(() => buildingLayout(footprint, door, [])).toThrow('walkable');
  expect(() => buildingLayout(footprint, { cell: footprint[0]!, edge: 'xMax' }, [{ x: 1, y: 0 }])).toThrow('boundary');
  expect(() =>
    buildingLayout(
      [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
      ],
      door,
      [{ x: 0, y: -1 }],
    ),
  ).toThrow('connected');
});
