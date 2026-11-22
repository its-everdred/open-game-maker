import { expect, it } from 'vitest';

import { assemblyMap } from '../src/assembly-map.js';
import { stoneGable } from '../src/assembly-roof.js';
import { IsoMap } from '../src/map.js';

it('covers both rows of a rectangular shell with elevated opposed roof bays', () => {
  const cells = Array.from({ length: 6 }, (_, i) => ({ x: i % 3, y: Math.floor(i / 3) }));
  const map = new IsoMap(assemblyMap(3, 2, stoneGable(cells)));
  for (const cell of cells) {
    expect(map.roofTilesAbove(cell.x, cell.y)).toMatchObject([{ facing: cell.y === 0 ? 'N' : 'S', elevation: 1.75 }]);
  }
  expect(() => stoneGable(cells.slice(1))).toThrow('two-row rectangle');
  expect(() => stoneGable([{ x: 0.5, y: 0 }])).toThrow('integer');
});
