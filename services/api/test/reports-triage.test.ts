import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { INTERNAL_TOKEN } from './helpers.js';
import { crash, ids, reportsApp } from './reports-helpers.js';

const service = (name = 'repair') => ({
  authorization: `Bearer ${INTERNAL_TOKEN}`,
  'content-type': 'application/json',
  'x-ogm-service': name,
});

async function withBundle() {
  const harness = await reportsApp();
  const created = (await (await harness.post(crash(), ids.owner)).json()) as { reportId: string; jobId: string };
  const uploaded = await harness.app.request(`/api/v1/reports/${created.reportId}/bundle`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-user': ids.owner },
    body: JSON.stringify({ seed: 7, actions: [{}] }),
  });
  expect(uploaded.status).toBe(201);
  return { ...harness, ...created };
}

describe('internal report triage', () => {
  it('allows only the repair service to claim and reclaims an expired processing item', async () => {
    const { app, reportId } = await withBundle();
    const claim = (headers: Record<string, string>, now: string, staleBefore: string) =>
      app.request('/api/v1/reports/triage/claim', {
        method: 'POST',
        headers,
        body: JSON.stringify({ now, staleBefore }),
      });

    expect((await claim(service('builder'), '2026-11-01T18:00:00.000Z', '2026-11-01T17:50:00.000Z')).status).toBe(403);
    const first = await claim(service(), '2026-11-01T18:00:00.000Z', '2026-11-01T17:50:00.000Z');
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ reportId, route: 'game_repair', bundleUrl: expect.any(String) });
    expect(await (await claim(service(), '2026-11-01T18:01:00.000Z', '2026-11-01T17:50:00.000Z')).json()).toEqual({
      report: null,
    });
    expect(await (await claim(service(), '2026-11-01T18:11:00.000Z', '2026-11-01T18:00:00.000Z')).json()).toMatchObject(
      { reportId },
    );
  });

  it('stores completion idempotently and cancels a non-reproduced provisional repair', async () => {
    const { app, deps, reportId, jobId } = await withBundle();
    await app.request('/api/v1/reports/triage/claim', {
      method: 'POST',
      headers: service(),
      body: JSON.stringify({ now: '2026-11-01T18:00:00.000Z', staleBefore: '2026-11-01T17:50:00.000Z' }),
    });
    const completion = {
      status: 'triaged',
      result: {
        reportId,
        replay: {
          class: 'not_reproducible',
          reason: 'no_actions',
          durationMs: 0,
        },
      },
    };
    const complete = () =>
      app.request(`/api/v1/reports/triage/${reportId}/complete`, {
        method: 'POST',
        headers: service(),
        body: JSON.stringify(completion),
      });

    expect((await complete()).status).toBe(200);
    expect((await complete()).status).toBe(200);
    expect(deps.db.select().from(schema.reports).where(eq(schema.reports.id, reportId)).get()).toMatchObject({
      triageState: 'stored',
    });
    expect(deps.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).get()).toMatchObject({
      state: 'cancelled',
      releasedAt: expect.any(String),
    });
  });

  it('caps private diagnostics at 200 KB and keeps only the opaque blob key on the report', async () => {
    const { app, deps, reportId } = await withBundle();
    await app.request('/api/v1/reports/triage/claim', {
      method: 'POST',
      headers: service(),
      body: JSON.stringify({ now: '2026-11-01T18:00:00.000Z', staleBefore: '2026-11-01T17:50:00.000Z' }),
    });
    const upload = (body: Uint8Array) =>
      app.request(`/api/v1/reports/triage/${reportId}/diagnostics`, {
        method: 'POST',
        headers: { ...service(), 'content-type': 'application/json' },
        body,
      });

    expect((await upload(new Uint8Array(200 * 1024 + 1))).status).toBe(413);
    const signature = 'd'.repeat(64);
    const response = await upload(
      new TextEncoder().encode(
        JSON.stringify({
          warning: 'private',
          finalState: { save: 'PRIVATE_STATE' },
          promise: {
            specPath: `promises/${signature}.spec.ts`,
            replayPath: `promises/${signature}.replay.json`,
            spec: 'promiseTest(replay);',
            replay: '{"private":true}',
          },
        }),
      ),
    );
    expect(response.status).toBe(201);
    const { diagnosticsKey } = (await response.json()) as { diagnosticsKey: string };
    expect(diagnosticsKey).toMatch(/^sha256:/);
    expect(deps.db.select().from(schema.reports).where(eq(schema.reports.id, reportId)).get()).toMatchObject({
      diagnosticsKey,
      triageJson: null,
    });
  });

  it('marks one reproduced crash ready and atomically dedupes a different intake signature into it', async () => {
    const harness = await reportsApp();
    const create = async (type: string, gameId = ids.game) =>
      (await (
        await harness.post(
          {
            ...crash(gameId),
            error: { ...crash(gameId).error, type },
          },
          ids.owner,
        )
      ).json()) as { reportId: string; jobId: string };
    const upload = (reportId: string) =>
      harness.app.request(`/api/v1/reports/${reportId}/bundle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-user': ids.owner },
        body: '{}',
      });
    const claim = () =>
      harness.app.request('/api/v1/reports/triage/claim', {
        method: 'POST',
        headers: service(),
        body: JSON.stringify({ now: '2026-11-01T18:00:00.000Z', staleBefore: '2026-11-01T17:50:00.000Z' }),
      });
    const diagnostics = async (reportId: string) => {
      const response = await harness.app.request(`/api/v1/reports/triage/${reportId}/diagnostics`, {
        method: 'POST',
        headers: service(),
        body: '{"warning":"private"}',
      });
      return ((await response.json()) as { diagnosticsKey: string }).diagnosticsKey;
    };
    const signature = 'd'.repeat(64);
    const result = (reportId: string, diagnosticsKey: string) => ({
      reportId,
      replay: {
        class: 'reproduces_with_error' as const,
        durationMs: 15,
      },
      signature,
      diagnosticsKey,
      ticket: { title: 'Repair crash', body: 'redacted repair context', labels: ['kind:repair'] },
      promise: {
        specPath: `promises/${signature}.spec.ts`,
        replayPath: `promises/${signature}.replay.json`,
      },
    });
    const complete = (reportId: string, value: ReturnType<typeof result> & { dedupedInto?: string }) =>
      harness.app.request(`/api/v1/reports/triage/${reportId}/complete`, {
        method: 'POST',
        headers: service(),
        body: JSON.stringify({ status: 'triaged', result: value }),
      });

    const first = await create('TypeError');
    await upload(first.reportId);
    expect((await claim()).status).toBe(200);
    const firstKey = await diagnostics(first.reportId);
    expect((await complete(first.reportId, result(first.reportId, firstKey))).status).toBe(200);

    const second = await create('RangeError');
    expect(second.jobId).not.toBe(first.jobId);
    await upload(second.reportId);
    expect((await claim()).status).toBe(200);
    const secondKey = await diagnostics(second.reportId);
    const response = await complete(second.reportId, result(second.reportId, secondKey));
    const completion = (await response.json()) as { result: Record<string, unknown> };
    expect(completion.result.dedupedInto).toBe(first.jobId);
    expect(completion.result).not.toHaveProperty('ticket');
    expect(completion.result).not.toHaveProperty('promise');
    expect(harness.deps.db.select().from(schema.jobs).where(eq(schema.jobs.id, second.jobId)).get()?.state).toBe(
      'cancelled',
    );
    expect(
      harness.deps.db.select().from(schema.reports).where(eq(schema.reports.id, second.reportId)).get(),
    ).toMatchObject({ triageState: 'deduped', jobId: first.jobId });

    harness.deps.db.update(schema.jobs).set({ state: 'done' }).where(eq(schema.jobs.id, first.jobId)).run();
    const afterTerminal = await create('SyntaxError');
    await upload(afterTerminal.reportId);
    expect((await claim()).status).toBe(200);
    const afterTerminalKey = await diagnostics(afterTerminal.reportId);
    const terminalResponse = await complete(afterTerminal.reportId, {
      ...result(afterTerminal.reportId, afterTerminalKey),
      dedupedInto: first.jobId,
    });
    expect(((await terminalResponse.json()) as { result: Record<string, unknown> }).result).not.toHaveProperty(
      'dedupedInto',
    );
    expect(
      harness.deps.db.select().from(schema.reports).where(eq(schema.reports.id, afterTerminal.reportId)).get(),
    ).toMatchObject({ triageState: 'ready', jobId: afterTerminal.jobId });

    const otherGame = await create('EvalError', ids.otherGame);
    await upload(otherGame.reportId);
    expect((await claim()).status).toBe(200);
    const otherGameKey = await diagnostics(otherGame.reportId);
    const crossGameResponse = await complete(otherGame.reportId, result(otherGame.reportId, otherGameKey));
    expect(((await crossGameResponse.json()) as { result: Record<string, unknown> }).result).not.toHaveProperty(
      'dedupedInto',
    );
    expect(
      harness.deps.db.select().from(schema.reports).where(eq(schema.reports.id, otherGame.reportId)).get(),
    ).toMatchObject({ triageState: 'ready', jobId: otherGame.jobId });
  });
});
