import { describe, expect, it } from 'vitest';

import { weekWindow } from '../../src/budget/week.js';

describe('weekly budget window', () => {
  it('starts on Monday in the configured zone and respects daylight saving changes', () => {
    expect(weekWindow(new Date('2026-11-01T12:00:00Z'), 'America/Los_Angeles')).toEqual({
      startsAt: '2026-10-26T07:00:00.000Z',
      resetsAt: '2026-11-02T08:00:00.000Z',
    });
    expect(weekWindow(new Date('2026-11-02T08:00:00Z'), 'America/Los_Angeles')).toEqual({
      startsAt: '2026-11-02T08:00:00.000Z',
      resetsAt: '2026-11-09T08:00:00.000Z',
    });
  });
});
