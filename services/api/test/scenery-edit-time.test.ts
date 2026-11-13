import { describe, expect, it } from 'vitest';
import { latestSceneryEdit } from '../src/scenery/edit-time.js';

describe('scenery edit time', () => {
  it('ignores newer unrelated edits and recognizes scenery changes and undo', () => {
    const row = (at: string, patch: unknown, inverse: unknown[] = []) => ({
      at,
      patches: JSON.stringify([patch]),
      inverse: JSON.stringify(inverse),
    });
    expect(
      latestSceneryEdit([
        row('later', { op: 'replace', path: ['globals', 'volume'], value: 1 }),
        row('scene', { op: 'replace', path: ['globals', 'scenery.terrain'], value: [] }),
      ]),
    ).toBe('scene');
    expect(
      latestSceneryEdit([
        row('delete', { op: 'remove', path: ['entities', 'tree'] }, [
          { op: 'add', path: ['entities', 'tree'], value: { prefab: 'scenery:tree' } },
        ]),
        row('older', { op: 'replace', path: ['globals', 'scenery.lighting'], value: 'night' }),
      ]),
    ).toBe('delete');
  });
});
