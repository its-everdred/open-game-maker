import { describe, expect, it } from 'vitest';
import type { WorkerBuild } from './BuildTracker';
import { activityProgress } from './activity-progress';

const worker = (percent: number | null, state = 'in-progress'): WorkerBuild => ({
  ticket: 'game:1',
  title: 'Build',
  percent,
  state,
  etaSeconds: null,
});

describe('activityProgress', () => {
  it('reports only working agents and averages their bounded progress', () => {
    expect(activityProgress([worker(20), worker(80), worker(100, 'human-review')])).toEqual({ count: 2, percent: 50 });
    expect(activityProgress([worker(-20), worker(120)])).toEqual({ count: 2, percent: 50 });
  });

  it('does not invent progress for missing or invalid values', () => {
    expect(activityProgress([])).toEqual({ count: 0, percent: null });
    expect(activityProgress([worker(70), worker(null)])).toEqual({ count: 2, percent: null });
    expect(activityProgress([worker(NaN)])).toEqual({ count: 1, percent: null });
  });
});
