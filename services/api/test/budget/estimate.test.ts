import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { classify, estimate, refineSizeClasses, startEstimateRefinement } from '../../src/budget/estimate.js';
import { ids, insertJob, NOW, worked } from './fixture.js';

const defaults = { dailyAllowanceMicroUsd: 5_000_000, resetZone: 'America/Los_Angeles' };
const seventyWords = Array.from({ length: 70 }, () => 'tweak').join(' ');

describe('classify', () => {
  it.each([
    ['fix the jump', 'small'],
    ['make the sky bluer', 'small'],
    ['add a coin sound', 'medium'],
    ['one more life', 'medium'],
    ['add three new enemies and a boss', 'large'],
    ['give the hero an inventory', 'large'],
    ['play a cutscene at the start', 'large'],
    ['make it multiplayer', 'huge'],
    ['rewrite the whole thing', 'huge'],
    [seventyWords, 'large'],
  ])('%s → %s', (summary, size) => {
    expect(classify(summary)).toBe(size);
  });

  it('lets an explicit complexity win over the summary', () => {
    expect(classify('make it multiplayer', 'feature', 1)).toBe('small');
  });

  it('never sizes a new game below large', () => {
    expect(classify('fix the jump', 'new_game')).toBe('large');
  });
});

describe('estimate', () => {
  it('answers the worked estimate from the seeded table', () => {
    const deps = worked();
    deps.db
      .insert(schema.allowances)
      .values({ familyId: ids.family, userId: ids.creator, dailyMicroUsd: 5_000_000 })
      .run();
    expect(
      estimate(
        { db: deps.db, defaults, now: () => NOW },
        { familyId: ids.family, creatorId: ids.creator, gameId: ids.game, summary: 'add three new enemies and a boss' },
      ),
    ).toEqual({ sizeClass: 'large', rangeMicroUsd: [4_000_000, 9_000_000], confidence: 'low', fits: false });
  });

  it('fits when p80 is within what is left today', () => {
    const deps = worked();
    expect(
      estimate(
        { db: deps.db, defaults, now: () => NOW },
        { familyId: ids.family, creatorId: ids.creator, gameId: ids.game, summary: 'fix the jump' },
      ).fits,
    ).toBe(true);
  });
});

describe('refineSizeClasses', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: NOW }));
  afterEach(() => vi.useRealTimers());

  function doneJobs(deps: ReturnType<typeof worked>, usages: number[], sizeClass = 'large') {
    usages.forEach((usage, index) =>
      insertJob(deps, {
        id: `j_${sizeClass}-${index}`,
        state: 'done',
        usageMicroUsd: usage,
        reservation: JSON.stringify({ amountMicroUsd: 9_000_000, sizeClass, confidence: 'low' }),
      }),
    );
  }
  const row = (deps: ReturnType<typeof worked>, sizeClass: 'small' | 'medium' | 'large' | 'huge') =>
    deps.db
      .select()
      .from(schema.sizeClasses)
      .all()
      .find((entry) => entry.kind === 'feature' && entry.sizeClass === sizeClass);

  it('keeps the seed below five samples', () => {
    const deps = worked();
    doneJobs(
      deps,
      [3, 4, 5, 6].map((m) => m * 1_000_000),
    );
    expect(refineSizeClasses(deps.db).updated).toEqual([]);
    expect(row(deps, 'large')).toMatchObject({ p50MicroUsd: 4_000_000, p80MicroUsd: 9_000_000, samples: 0 });
  });

  it('replaces only the sampled class once it has enough done jobs', () => {
    const deps = worked();
    doneJobs(
      deps,
      [3, 4, 5, 6, 7, 8].map((m) => m * 1_000_000),
    );
    doneJobs(deps, [1_000_000, 2_000_000], 'small');
    insertJob(deps, { id: 'j_zero', state: 'done', usageMicroUsd: 0 });
    const before = deps.db.select().from(schema.sizeClasses).all();

    expect(refineSizeClasses(deps.db).updated).toEqual([{ kind: 'feature', sizeClass: 'large', samples: 6 }]);
    expect(row(deps, 'large')).toMatchObject({ p50MicroUsd: 5_000_000, p80MicroUsd: 7_000_000, samples: 6 });
    const after = deps.db.select().from(schema.sizeClasses).all();
    expect(after.filter((entry) => !(entry.kind === 'feature' && entry.sizeClass === 'large'))).toEqual(
      before.filter((entry) => !(entry.kind === 'feature' && entry.sizeClass === 'large')),
    );

    refineSizeClasses(deps.db);
    expect(row(deps, 'large')).toMatchObject({ p50MicroUsd: 5_000_000, p80MicroUsd: 7_000_000, samples: 6 });
  });

  it('does not price a class at its single outlier', () => {
    const deps = worked();
    doneJobs(
      deps,
      [3, 4, 5, 6, 40].map((m) => m * 1_000_000),
    );
    refineSizeClasses(deps.db);
    expect(row(deps, 'large')).toMatchObject({ p50MicroUsd: 5_000_000, p80MicroUsd: 6_000_000, samples: 5 });
  });

  it('ignores jobs that are not done', () => {
    const deps = worked();
    doneJobs(
      deps,
      [3, 4, 5, 6, 7, 8].map((m) => m * 1_000_000),
    );
    deps.db.update(schema.jobs).set({ state: 'failed' }).where(eq(schema.jobs.id, 'j_large-0')).run();
    expect(refineSizeClasses(deps.db).updated).toEqual([{ kind: 'feature', sizeClass: 'large', samples: 5 }]);
  });
});

describe('startEstimateRefinement', () => {
  afterEach(() => vi.useRealTimers());

  it('refines at boot and once, 60 s after the last terminal job', () => {
    vi.useFakeTimers({ now: NOW });
    const deps = worked();
    doneJobs6(deps);
    const stop = startEstimateRefinement({ db: deps.db, events: deps.events, log: deps.log });
    const refined = () => deps.lines.filter((line) => line.event === 'size-classes-refined').length;
    expect(refined()).toBe(1);

    const changed = (state: 'running' | 'done') =>
      deps.events.emit('job.changed', { jobId: 'j_large-0', gameId: ids.game, familyId: ids.family, state });
    changed('running');
    vi.advanceTimersByTime(61_000);
    expect(refined()).toBe(1);

    changed('done');
    vi.advanceTimersByTime(30_000);
    changed('done');
    vi.advanceTimersByTime(59_000);
    expect(refined()).toBe(1);
    vi.advanceTimersByTime(1_000);
    expect(refined()).toBe(2);
    stop();
  });
});

function doneJobs6(deps: ReturnType<typeof worked>) {
  [3, 4, 5, 6, 7, 8].forEach((m, index) =>
    insertJob(deps, {
      id: `j_large-${index}`,
      state: 'done',
      usageMicroUsd: m * 1_000_000,
      reservation: JSON.stringify({ amountMicroUsd: 9_000_000, sizeClass: 'large', confidence: 'low' }),
    }),
  );
}
