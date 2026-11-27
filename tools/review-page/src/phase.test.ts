import { expect, it } from 'vitest';
import { phaseFor, updatePhase } from './phase.js';
import type { Source } from './sources.js';

it('moves a review ticket to its selected phase and preserves unrelated labels', () => {
  const source: Source = { key: 'core', checkout: '.', repository: 'example/repo', aiur: 'aiur', decideRepo: 'core' };
  const calls: string[][] = [];
  const run = (_program: string, args: string[]) => {
    calls.push(args);
    return JSON.stringify({ labels: [{ name: 'phase:mock' }, { name: 'model:low' }, { name: 'feature:test' }] });
  };
  expect(phaseFor(['phase:mock'])).toEqual({ at: 'mock', next: 'prototype' });
  updatePhase({ key: 'dec_a', at: 1, repo: 'core', ticket: 1, advance: 'prototype' }, source, run);
  expect(calls[1]).toContain('phase:prototype,model:medium');
  expect(calls[1]).toContain('phase:mock');
  expect(calls[1]).not.toContain('feature:test');
});
