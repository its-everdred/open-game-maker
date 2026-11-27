import { describe, expect, it } from 'vitest';
import { report, type Disposition, type Wake } from '../../../scripts/meta/overlap-report.ts';

const now = new Date('2026-11-26T12:00:00Z');
const wake: Wake = {
  wake_id: 1,
  kind: 'feature_overlap',
  first_seen_at: '2026-11-26T11:30:00Z',
  message: 'Within feature combat: ticket #1 overlaps PR #2.',
};
const disposition: Disposition = {
  wake_id: 1,
  classification: 'duplicate_implementation',
  finding_id: 'attack-pair',
  reviewed_at: '2026-11-26T11:40:00Z',
  finding_evidence: 'both implement attack routing',
  acted_at: '2026-11-26T11:45:00Z',
  action_evidence: 'folded #3 into #2',
};

describe('overlap report', () => {
  it('counts reviewed findings and actions while leaving incomplete metrics unknown', () => {
    const other: Wake = {
      ...wake,
      wake_id: 2,
      first_seen_at: '2026-11-25T11:30:00Z',
      message: 'Across features combat, ui: ticket #3 overlaps PR #4.',
    };
    const result = report([wake, other], [disposition], now);
    expect(result.features.combat).toMatchObject({
      confirmed_duplicate_implementations_this_week: 1,
      duplicate_implementations_this_week: null,
      observed_raised_this_hour: 1,
      observed_acted_this_hour: 1,
      unclassified_this_week: 1,
    });
    expect(result.features.ui?.unclassified_this_week).toBe(1);
  });

  it('counts a recent action on an older proposal without counting an old finding this week', () => {
    const old = { ...wake, first_seen_at: '2026-11-01T10:00:00Z' };
    const oldReview = { ...disposition, reviewed_at: '2026-11-01T11:00:00Z' };
    expect(report([old], [oldReview], now).features.combat).toMatchObject({
      observed_acted_this_hour: 1,
      confirmed_duplicate_implementations_this_week: 0,
    });
  });

  it('counts confirmed duplicates reported by work overlap reviews', () => {
    const workOverlap: Wake = { ...wake, kind: 'work_overlap' };
    expect(report([workOverlap], [disposition], now, ['combat'], true).features.combat).toMatchObject({
      duplicate_implementations_this_week: 1,
      confirmed_duplicate_implementations_this_week: 1,
    });
  });

  it('does not classify a finding before its review takes place', () => {
    const future = { ...disposition, reviewed_at: '2026-11-27T11:40:00Z' };
    expect(report([wake], [future], now, ['combat'], true).features.combat).toMatchObject({
      duplicate_implementations_this_week: null,
      unclassified_this_week: 1,
    });
  });

  it('counts creator questions by delivery time and deduplicates repeated wakes', () => {
    const question: Wake = {
      wake_id: 4,
      kind: 'creator_question_overlap',
      first_seen_at: '2026-11-01T10:00:00Z',
      message: 'question overlap',
    };
    const decision: Disposition = {
      wake_id: 4,
      feature: 'ui',
      classification: 'overlapping_question_reached_creator',
      delivery_id: 'review-9',
      reviewed_at: '2026-11-26T11:00:00Z',
      reached_at: '2026-11-25T12:00:00Z',
      finding_evidence: 'review #9 repeats #8',
    };
    expect(
      report([question], [decision], now).features.ui?.confirmed_overlapping_questions_reaching_creator_this_week,
    ).toBe(1);
    expect(
      report([wake, { ...wake, wake_id: 2 }], [disposition, { ...disposition, wake_id: 2 }], now).features.combat
        ?.confirmed_duplicate_implementations_this_week,
    ).toBe(1);
  });

  it('requires evidence and rejects missing, duplicate and invalid records', () => {
    expect(() => report([], [{ ...disposition, classification: 'bad' as Disposition['classification'] }], now)).toThrow(
      'invalid overlap disposition',
    );
    expect(() => report([wake], [{ ...disposition, action_evidence: '' }], now)).toThrow('action_evidence');
    expect(() => report([wake], [{ ...disposition, finding_evidence: '' }], now)).toThrow('finding_evidence');
    expect(() => report([wake], [{ ...disposition, wake_id: 2 }], now)).toThrow('missing overlap wake');
    expect(() => report([wake, wake], [], now)).toThrow('duplicate overlap wake');
  });

  it('includes every feature and only reports zero when coverage is verified and classified', () => {
    const incomplete = report([], [], now, ['combat', 'world']);
    expect(Object.keys(incomplete.features)).toEqual(['combat', 'world']);
    expect(incomplete.features.combat?.duplicate_implementations_this_week).toBeNull();
    expect(report([], [], now, ['combat'], true).features.combat?.duplicate_implementations_this_week).toBe(0);
    const unassigned: Wake = {
      wake_id: 5,
      kind: 'work_overlap',
      first_seen_at: '2026-11-26T11:00:00Z',
      message: 'overlap',
    };
    expect(
      report([unassigned], [], now, ['combat'], true).features.combat?.duplicate_implementations_this_week,
    ).toBeNull();
  });
});
