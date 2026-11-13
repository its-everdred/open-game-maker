import { describe, expect, it } from 'vitest';
import { SceneryHistory, snapToGround } from './edit.js';
import { ScenerySchema } from './data.js';

const empty = ScenerySchema.parse({
  version: 1,
  items: [],
  terrain: [],
  lighting: 'night',
  camera: { position: [0, 1, 2], target: [0, 0, 0], zoom: 1 },
});

describe('scenery editing', () => {
  it('undoes independent edits and keeps returned snapshots isolated', () => {
    const history = new SceneryHistory(empty);
    const changed = history.update((scene) => {
      scene.lighting = 'cave';
    });
    changed.lighting = 'night';
    expect(history.snapshot().lighting).toBe('cave');
    expect(history.undo().lighting).toBe('night');
  });
  it('snaps to the ground at the requested coordinates', () => {
    expect(snapToGround([2, 9, 3], (x, z) => x + z)).toEqual([2, 5, 3]);
    expect(() => snapToGround([0, 0, 0], () => NaN)).toThrow();
  });
});
