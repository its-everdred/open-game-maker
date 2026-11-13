import { describe, expect, it } from 'vitest';

import { workerProgress } from '../../src/worker-progress/progress.js';

describe('worker progress', () => {
  it('prefers the daemon percentage and estimates remaining time from runtime', () => {
    expect(workerProgress({ percent: 40, runtimeSeconds: 60, workpad: '- [x] Done\n- [ ] Later' })).toEqual({
      percent: 40,
      etaSeconds: 90,
      source: 'daemon',
    });
  });

  it('uses workpad checklist completion when daemon progress is unavailable', () => {
    expect(workerProgress({ runtimeSeconds: 60, workpad: '## Agent Workpad\n- [x] First\n- [ ] Second' })).toEqual({
      percent: 50,
      etaSeconds: 60,
      source: 'workpad',
    });
  });

  it('keeps progress and ETA unknown when no estimate is possible', () => {
    expect(workerProgress({ runtimeSeconds: 60, workpad: 'No checklist' })).toEqual({
      percent: null,
      etaSeconds: null,
      source: 'unknown',
    });
    expect(workerProgress({ percent: 0, runtimeSeconds: 60 }).etaSeconds).toBeNull();
  });
});
