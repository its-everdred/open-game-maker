import { expect, it } from 'vitest';
import { validateSceneRoutes } from '../src/scene/routes.js';

it('requires a route to reach its gate even when the endpoints connect by another path', () => {
  const grid = { width: 3, height: 3, cells: Array<boolean>(9).fill(true) };
  const route = [
    {
      id: 'entrance',
      waypoints: [
        { x: 0, y: 1 },
        { x: 1, y: 1 },
        { x: 2, y: 1 },
      ],
    },
  ];
  expect(() => validateSceneRoutes(grid, [], route)).not.toThrow();
  expect(() => validateSceneRoutes(grid, [{ x: 1, y: 1 }], route)).toThrow('blocked waypoint');
});

it('rejects disconnected routes and out-of-bounds inputs', () => {
  const grid = { width: 3, height: 2, cells: [true, false, true, true, false, true] };
  const route = [
    {
      id: 'entrance',
      waypoints: [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
      ],
    },
  ];
  expect(() => validateSceneRoutes(grid, [], route)).toThrow('disconnected');
  expect(() => validateSceneRoutes(grid, [{ x: 3, y: 0 }], route)).toThrow('collision');
});
