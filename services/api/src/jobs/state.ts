import type { JobState } from '@ogm/contracts';

import { HttpError } from '../app/errors.js';

export type JobEvent = 'admit' | 'file' | 'run' | 'pause' | 'resume' | 'finish' | 'fail' | 'cancel';

const TRANSITIONS: Record<JobState, Partial<Record<JobEvent, JobState>>> = {
  queued: { admit: 'admitted', fail: 'failed', cancel: 'cancelled' },
  admitted: { file: 'filed', fail: 'failed', cancel: 'cancelled' },
  // New Game planning uses a separate worker ticket; its parent remains a non-dispatchable record.
  filed: { run: 'running', finish: 'done', fail: 'failed', cancel: 'cancelled' },
  running: { pause: 'paused_budget', finish: 'done', fail: 'failed', cancel: 'cancelled' },
  paused_budget: { resume: 'running', finish: 'done', fail: 'failed', cancel: 'cancelled' },
  done: {},
  failed: {},
  cancelled: {},
};

export const SLOT_STATES = ['admitted', 'filed', 'running', 'paused_budget'] as const satisfies readonly JobState[];

export function transition(state: JobState, event: JobEvent): JobState {
  const next = TRANSITIONS[state][event];
  if (!next) throw new HttpError(409, 'invalid_transition', `invalid_transition: ${state} -> ${event}`);
  return next;
}

export const isTerminal = (state: JobState): boolean => state === 'done' || state === 'failed' || state === 'cancelled';

export const holdsSlot = (state: JobState): boolean => SLOT_STATES.includes(state as (typeof SLOT_STATES)[number]);
