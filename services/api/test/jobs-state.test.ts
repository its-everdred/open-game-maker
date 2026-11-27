import { describe, expect, it } from 'vitest';

import type { JobState } from '@ogm/contracts';

import { holdsSlot, isTerminal, transition, type JobEvent } from '../src/jobs/state.js';

const states: JobState[] = ['queued', 'admitted', 'filed', 'running', 'paused_budget', 'done', 'failed', 'cancelled'];
const events: JobEvent[] = ['admit', 'file', 'run', 'pause', 'resume', 'finish', 'fail', 'cancel'];
const allowed = new Map<string, JobState>([
  ['queued:admit', 'admitted'],
  ['queued:cancel', 'cancelled'],
  ['admitted:file', 'filed'],
  ['admitted:fail', 'failed'],
  ['admitted:cancel', 'cancelled'],
  ['filed:run', 'running'],
  ['filed:finish', 'done'],
  ['filed:fail', 'failed'],
  ['filed:cancel', 'cancelled'],
  ['running:pause', 'paused_budget'],
  ['running:finish', 'done'],
  ['running:fail', 'failed'],
  ['running:cancel', 'cancelled'],
  ['paused_budget:resume', 'running'],
  ['paused_budget:finish', 'done'],
  ['paused_budget:fail', 'failed'],
  ['paused_budget:cancel', 'cancelled'],
]);

describe('job state', () => {
  it('accepts exactly the declared transition table', () => {
    for (const state of states) {
      for (const event of events) {
        const expected = allowed.get(`${state}:${event}`);
        if (expected) expect(transition(state, event), `${state}:${event}`).toBe(expected);
        else expect(() => transition(state, event), `${state}:${event}`).toThrowError(/invalid_transition/);
      }
    }
  });

  it('identifies terminal and slot-holding states', () => {
    expect(states.filter(isTerminal)).toEqual(['done', 'failed', 'cancelled']);
    expect(states.filter(holdsSlot)).toEqual(['admitted', 'filed', 'running', 'paused_budget']);
  });
});
