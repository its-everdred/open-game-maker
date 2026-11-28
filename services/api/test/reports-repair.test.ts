import { schema } from '@ogm/db';
import { describe, expect, it, vi } from 'vitest';

import { CommitServiceIssueWriter, StoredIssueWriter } from '../src/reports/issue-writer.js';
import { REPAIR_ATTEMPTS, REPAIR_RESERVATION_FRACTION } from '../src/reports/policy.js';
import { admitRepair, repairPlan } from '../src/reports/repair.js';
import { makeDeps } from './helpers.js';
import { ids, reportsApp } from './reports-helpers.js';

const SIG = 'c'.repeat(64);
const input = {
  gameId: ids.game,
  ownerId: ids.owner,
  familyId: ids.family,
  reportId: 'r_70000000-0000-4000-8000-0000000000aa',
  releaseId: ids.release,
  signature: SIG,
  reproduction: 'crash_with_error' as const,
};
const defaults = { dailyAllowanceMicroUsd: 5_000_000, resetZone: 'America/Los_Angeles' };

describe('repair admission', () => {
  it('admits a medium repair at the repair/medium p80 reservation, owned by the game owner', async () => {
    const { deps } = await reportsApp();
    const outcome = await admitRepair({ ...deps, defaults }, input);
    const job = deps.db.select().from(schema.jobs).get()!;
    expect(outcome.jobId).toBe(job.id);
    expect(job).toMatchObject({ kind: 'repair', complexity: 2, creatorId: ids.owner, slot: 'edit' });
    const p80 = deps.db
      .select()
      .from(schema.sizeClasses)
      .all()
      .find((r) => r.kind === 'repair' && r.sizeClass === 'medium')!;
    expect(JSON.parse(job.reservation)).toMatchObject({ sizeClass: 'medium', amountMicroUsd: p80.p80MicroUsd });
    const feature = deps.db
      .select()
      .from(schema.sizeClasses)
      .all()
      .find((r) => r.kind === 'feature' && r.sizeClass === 'medium')!;
    expect(p80.p80MicroUsd).toBeLessThan(feature.p80MicroUsd / 2);
  });

  // Until real samples replace them, repair prices are the feature prices scaled by the configured fraction.
  it('seeds every repair size class at the configured fraction of the feature price', async () => {
    const { deps } = await reportsApp();
    const rows = deps.db.select().from(schema.sizeClasses).all();
    for (const repair of rows.filter((r) => r.kind === 'repair')) {
      const feature = rows.find((r) => r.kind === 'feature' && r.sizeClass === repair.sizeClass)!;
      for (const field of ['p50MicroUsd', 'p80MicroUsd'] as const) {
        expect(Math.abs(repair[field] - feature[field] * REPAIR_RESERVATION_FRACTION)).toBeLessThanOrEqual(
          feature[field] * 0.001,
        );
      }
    }
  });

  it('returns pendingBudget and spends nothing when the owner has no allowance', async () => {
    const { deps } = await reportsApp({ ownerDaily: 0 });
    expect(await admitRepair({ ...deps, defaults }, input)).toEqual({ pendingBudget: true });
    expect(deps.db.select().from(schema.jobs).all()).toHaveLength(0);
    expect(deps.db.select().from(schema.budgetLedger).all()).toHaveLength(0);
  });

  it('returns the weekly reset when the owner has no edit Energy', async () => {
    const { deps } = await reportsApp();
    const date = new Date();
    deps.db
      .insert(schema.user)
      .values({
        id: ids.owner,
        name: 'Owner',
        email: 'owner@example.test',
        emailVerified: true,
        createdAt: date,
        updatedAt: date,
      })
      .run();
    deps.db
      .insert(schema.allowedUsers)
      .values({ email: 'owner@example.test', role: 'maker', addedBy: 'env', addedAt: date.toISOString() })
      .run();
    deps.db.insert(schema.weeklyJobBudgets).values({ email: 'owner@example.test', newGames: 2, edits: 0 }).run();
    expect(await admitRepair({ ...deps, defaults }, input)).toEqual({
      pendingBudget: true,
      budgetReason: 'weekly_user',
      resetsAt: expect.any(String),
    });
    expect(deps.db.select().from(schema.jobs).all()).toHaveLength(0);
  });

  // The attempt bound is what stops a crash that keeps coming back from draining the owner's allowance.
  it(`refuses a repair after ${REPAIR_ATTEMPTS} attempts on one signature, spending nothing`, async () => {
    const { deps } = await reportsApp();
    const admission = { ...deps, defaults };
    const first = await admitRepair(admission, input);
    const second = await admitRepair(admission, { ...input, previousJobId: first.jobId });
    expect(second.jobId).toBeDefined();
    expect(REPAIR_ATTEMPTS).toBe(2);
    const ledger = deps.db.select().from(schema.budgetLedger).all().length;

    expect(await admitRepair(admission, { ...input, previousJobId: second.jobId })).toEqual({
      attemptsExhausted: true,
    });
    expect(deps.db.select().from(schema.jobs).all()).toHaveLength(2);
    expect(deps.db.select().from(schema.budgetLedger).all()).toHaveLength(ledger);

    // A retried second admission is still idempotent, and another signature has its own bound.
    expect(await admitRepair(admission, { ...input, previousJobId: first.jobId })).toEqual({ jobId: second.jobId });
    expect((await admitRepair(admission, { ...input, signature: 'd'.repeat(64) })).jobId).toBeDefined();
  });

  it('builds a plan from redacted metadata only, with the attempt limit in acceptance', () => {
    const plan = JSON.stringify(repairPlan(input));
    expect(plan).toContain(SIG);
    expect(plan).toContain(input.reportId);
    expect(plan).toContain(`at most ${REPAIR_ATTEMPTS} attempts`);
    for (const leaked of ['applyDamage', 'combat.js', 'sha256:', 'hp']) expect(plan).not.toContain(leaked);
  });
});

describe('issue writers', () => {
  const issue = { title: 'Platform TypeError', body: 'Signature x', labels: ['bug', 'source:report'] };

  it('stores platform issues in the operator queue by default', async () => {
    const deps = makeDeps();
    const { ref } = await new StoredIssueWriter(deps.db).file(issue);
    const row = deps.db.select().from(schema.platformIssueQueue).get()!;
    expect(ref).toBe(`queue:${row.id}`);
    expect(row).toMatchObject({ status: 'pending', title: issue.title });
  });

  it('never files an issue carrying a daemon label under any prefix', async () => {
    const deps = makeDeps();
    for (const label of ['agent:todo', 'castle-run:todo', 'castle-run:blocked']) {
      await expect(new StoredIssueWriter(deps.db).file({ ...issue, labels: [label] })).rejects.toThrow();
    }
    const fetch = vi.fn();
    await expect(
      new CommitServiceIssueWriter({ baseUrl: 'http://127.0.0.1:1', token: 't', fetch }).file({
        ...issue,
        labels: ['agent:todo', 'castle-run:todo'],
      }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    // A game repo's own labels are not daemon labels: the platform queue still files them.
    const { ref } = await new StoredIssueWriter(deps.db).file({ ...issue, labels: ['complexity:2', 'source:report'] });
    expect(ref).toMatch(/^queue:/);
  });

  it('files through the commit service file_issue op', async () => {
    const fetch = vi.fn(async () => Response.json({ ok: true, sha: 'issue:42' }));
    const writer = new CommitServiceIssueWriter({ baseUrl: 'http://127.0.0.1:4301/', token: 'tok', fetch });
    expect(await writer.file(issue)).toEqual({ ref: 'issue:42' });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:4301/internal/commit');
    expect(JSON.parse(init.body as string)).toEqual({ kind: 'file_issue', ...issue });
    fetch.mockResolvedValueOnce(Response.json({ ok: false, verdict: {} }, { status: 422 }));
    await expect(writer.file(issue)).rejects.toThrow(/refused/);
  });
});
