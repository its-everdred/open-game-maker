import { CreateJobRequest } from '@ogm/contracts/browser';
import { describe, expect, it } from 'vitest';

import type { Hd2dDoc } from './controls';
import { hd2dSaveRequest } from './save';

const doc = {
  version: 1,
  lighting: {
    ambient: { color: '#ffffff', intensity: 0.8 },
    shafts: { direction: 1.1, color: '#ffd77a', intensity: 0.3, count: 2 },
  },
  focus: { mode: 'depthBands', target: 'player', smoothing: 0.15, strength: 0.6, range: 0.25 },
  atmosphere: {},
  particles: { emitters: [], wind: { direction: [1, 0, 0], strength: 1, seed: 1 } },
} satisfies Hd2dDoc;

describe('hd2dSaveRequest', () => {
  // Parity rests on the agent writing exactly what Kevin saw: the document has to reach it whole and parseable.
  it('asks the game agent to write the exact document for the open scene', () => {
    const request = hd2dSaveRequest(
      { gameId: 'g_0b7c2f3e-4a5d-4e6f-8a9b-0c1d2e3f4a5b', branchId: 'main' },
      { scene: 'forest-clearing', doc },
      'edit:1',
    );
    expect(CreateJobRequest.safeParse(request).success).toBe(true);
    expect(request.plan.summary).toContain('the "forest-clearing" scene');
    const sent = request.plan.summary.slice(request.plan.summary.indexOf('{'));
    expect(JSON.parse(sent)).toEqual(doc);
    expect(request.plan.title.length).toBeLessThanOrEqual(120);
  });

  it('refuses a document too large for a job rather than cutting it', () => {
    const big = {
      ...doc,
      lighting: { ...doc.lighting, ambient: { color: '#ffffff', intensity: 0.8, note: 'x'.repeat(4000) } },
    };
    expect(() => hd2dSaveRequest({ gameId: 'g', branchId: 'main' }, { doc: big as Hd2dDoc }, 'edit:2')).toThrow(
      RangeError,
    );
  });
});
