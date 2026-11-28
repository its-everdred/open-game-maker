import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { StoredIssueWriter } from '../src/reports/issue-writer.js';
import { asUser } from './helpers.js';
import { crash, ids, reportsApp } from './reports-helpers.js';

type Created = { reportId: string; signature: string; route: string; jobId?: string; pendingBudget?: true };

describe('POST /api/v1/reports', () => {
  it('routes the worked example to one repair job and attaches the duplicate', async () => {
    const { deps, post } = await reportsApp();
    const first = await post(crash());
    expect(first.status).toBe(201);
    const a = (await first.json()) as Created;
    const b = (await (await post(crash())).json()) as Created;

    expect(a.route).toBe('game_repair');
    expect(a.jobId).toMatch(/^j_/);
    expect(b).toMatchObject({ route: 'game_repair', signature: a.signature, jobId: a.jobId });
    expect(b.reportId).not.toBe(a.reportId);
    const jobs = deps.db.select().from(schema.jobs).all();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      kind: 'repair',
      creatorId: ids.owner,
      slot: 'edit',
      idempotencyKey: `repair:${a.signature}`,
    });
    const sig = deps.db.select().from(schema.reportSignatures).all();
    expect(sig).toEqual([
      expect.objectContaining({ signature: a.signature, scope: 'game', count: 2, openJobId: a.jobId }),
    ]);
  });

  it('files a host-frame crash to the platform queue with no user text', async () => {
    const { deps, post } = await reportsApp();
    const report = { ...crash(ids.game, '@ogm/host/bridge.js'), text: 'my secret player words' };
    const body = (await (await post(report)).json()) as Created;
    await post(report);

    expect(body.route).toBe('platform');
    expect(body.jobId).toBeUndefined();
    expect(deps.db.select().from(schema.jobs).all()).toHaveLength(0);
    const queue = deps.db.select().from(schema.platformIssueQueue).all();
    expect(queue).toHaveLength(1);
    expect(queue[0].body).toContain("cannot read properties of undefined (reading 'hp') at tick #");
    expect(queue[0].body).not.toContain('secret');
    expect(queue[0].body).not.toContain('4312');
    expect(JSON.parse(queue[0].labelsJson)).toEqual(['bug', 'source:report']);
    const sig = deps.db
      .select()
      .from(schema.reportSignatures)
      .where(eq(schema.reportSignatures.signature, body.signature))
      .get();
    expect(sig).toMatchObject({ scope: 'platform', gameId: null, count: 2, platformRef: `queue:${queue[0].id}` });
  });

  it('turns the same crash from a second game into a platform bug', async () => {
    const { deps, post } = await reportsApp();
    expect(((await (await post(crash(ids.game))).json()) as Created).route).toBe('game_repair');
    const second = (await (await post(crash(ids.otherGame))).json()) as Created;
    expect(second.route).toBe('platform');
    expect(deps.db.select().from(schema.jobs).all()).toHaveLength(1);
    expect(deps.db.select().from(schema.platformIssueQueue).get()?.body).toContain('Games affected 2');
  });

  it('offers tuning complaints as editor hints without spending', async () => {
    const { deps, post } = await reportsApp();
    const body = (await (
      await post({ gameId: ids.game, buildHash: 'b'.repeat(64), text: 'the enemy is too fast' })
    ).json()) as Created;
    expect(body.route).toBe('editor_hint');
    expect(deps.db.select().from(schema.jobs).all()).toHaveLength(0);
  });

  it('accepts a player report with the running build id', async () => {
    const { app, deps } = await reportsApp();
    const response = await app.request('/api/v1/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-user': ids.player },
      body: JSON.stringify({ gameId: ids.game, buildHash: 'b_1f2e3d4c', text: 'the door is stuck' }),
    });

    expect(response.status).toBe(201);
    expect(deps.db.select().from(schema.reports).get()?.buildHash).toBe('b_1f2e3d4c');
  });

  it('rejects build ids that could escape the game build directory', async () => {
    const { app } = await reportsApp();
    const response = await app.request('/api/v1/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-user': ids.player },
      body: JSON.stringify({ gameId: ids.game, buildHash: '../secrets', text: 'the door is stuck' }),
    });

    expect(response.status).toBe(400);
  });

  it('admits one repair on the third matching wrong-behaviour report', async () => {
    const { deps, post } = await reportsApp();
    const report = { gameId: ids.game, releaseId: ids.release, buildHash: 'b'.repeat(64), text: 'jumping feels wrong' };
    const routes: Created[] = [];
    for (let i = 0; i < 4; i += 1) routes.push((await (await post(report)).json()) as Created);
    expect(routes.map((r) => r.route)).toEqual(['stored', 'stored', 'game_repair', 'game_repair']);
    expect(routes[3].jobId).toBe(routes[2].jobId);
    const jobs = deps.db.select().from(schema.jobs).all();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].plan).toContain('wrong_behaviour');
  });

  it('stores the report with pendingBudget when the owner has nothing left', async () => {
    const { deps, post } = await reportsApp({ ownerDaily: 0 });
    const response = await post(crash());
    expect(response.status).toBe(201);
    const body = (await response.json()) as Created;
    expect(body).toMatchObject({ route: 'stored', pendingBudget: true });
    expect(body.jobId).toBeUndefined();
    expect(deps.db.select().from(schema.jobs).all()).toHaveLength(0);
    expect(deps.db.select().from(schema.reports).get()?.route).toBe('stored');
    expect(deps.db.select().from(schema.reportSignatures).get()).toMatchObject({ status: 'open', openJobId: null });
  });

  it('returns 502 with the report kept when admission fails for another reason', async () => {
    const { deps, post } = await reportsApp();
    deps.db
      .update(schema.familyMembers)
      .set({ capability: 'player' })
      .where(eq(schema.familyMembers.userId, ids.owner))
      .run();
    const response = await post(crash());
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: 'repair_admission_failed' });
    expect(deps.db.select().from(schema.reports).all()).toHaveLength(1);
  });

  it('re-admits a crash that comes back after its repair is done, but not after a failed one', async () => {
    const { deps, post } = await reportsApp();
    const first = (await (await post(crash())).json()) as Created;
    deps.db.update(schema.jobs).set({ state: 'done' }).where(eq(schema.jobs.id, first.jobId!)).run();

    const recurred = (await (await post(crash())).json()) as Created;
    expect(recurred.route).toBe('game_repair');
    expect(recurred.jobId).toMatch(/^j_/);
    expect(recurred.jobId).not.toBe(first.jobId);
    expect((await (await post(crash())).json()) as Created).toMatchObject({ jobId: recurred.jobId });

    deps.db.update(schema.jobs).set({ state: 'failed' }).where(eq(schema.jobs.id, recurred.jobId!)).run();
    const afterFailure = (await (await post(crash())).json()) as Created;
    expect(afterFailure.route).toBe('stored');
    expect(afterFailure.jobId).toBeUndefined();
    expect(deps.db.select().from(schema.jobs).all()).toHaveLength(2);
  });

  it('retries a budget-refused repair on the next matching report', async () => {
    const { deps, post } = await reportsApp({ ownerDaily: 0 });
    expect(((await (await post(crash())).json()) as Created).pendingBudget).toBe(true);
    deps.db
      .update(schema.allowances)
      .set({ dailyMicroUsd: 5_000_000 })
      .where(eq(schema.allowances.userId, ids.owner))
      .run();
    const retried = (await (await post(crash())).json()) as Created;
    expect(retried).toMatchObject({ route: 'game_repair', jobId: expect.stringMatching(/^j_/) });
    expect(deps.db.select().from(schema.reportSignatures).get()?.openJobId).toBe(retried.jobId);
  });

  it('files the platform issue on the next report when the writer failed', async () => {
    const { deps, post } = await reportsApp();
    const file = vi.spyOn(StoredIssueWriter.prototype, 'file').mockRejectedValueOnce(new Error('queue down'));
    const report = crash(ids.game, '@ogm/host/bridge.js');
    const first = (await (await post(report)).json()) as Created;
    expect(first.route).toBe('platform');
    expect(deps.db.select().from(schema.reportSignatures).get()?.platformRef).toBeNull();
    await post(report);
    await post(report);
    expect(file).toHaveBeenCalledTimes(2);
    expect(deps.db.select().from(schema.platformIssueQueue).all()).toHaveLength(1);
    file.mockRestore();
  });

  it('files one platform issue when matching reports arrive together', async () => {
    const { deps, post } = await reportsApp();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const file = vi.spyOn(StoredIssueWriter.prototype, 'file').mockImplementation(async () => {
      await held;
      return { ref: 'queue:held' };
    });
    const report = crash(ids.game, '@ogm/host/bridge.js');
    const both = Promise.all([post(report), post(report)]);
    await vi.waitFor(() => expect(deps.db.select().from(schema.reports).all()).toHaveLength(2));
    release();
    expect((await both).map((r) => r.status)).toEqual([201, 201]);
    expect(file).toHaveBeenCalledTimes(1);
    expect(deps.db.select().from(schema.reportSignatures).get()?.platformRef).toBe('queue:held');
    file.mockRestore();
  });

  it('refuses players who cannot play the game', async () => {
    const { deps, post } = await reportsApp();
    const response = await post(crash(ids.privateGame), ids.player);
    expect(response.status).toBe(403);
    expect(deps.db.select().from(schema.reports).all()).toHaveLength(0);
  });

  it('rate-limits a user at 20 reports an hour', async () => {
    const { post } = await reportsApp();
    const report = { gameId: ids.game, buildHash: 'b'.repeat(64) };
    for (let i = 0; i < 20; i += 1) expect((await post(report)).status).toBe(201);
    expect((await post(report)).status).toBe(429);
    expect((await post(report, ids.owner)).status).toBe(201);
  });
});

describe('report bundles and reads', () => {
  async function withReport() {
    const harness = await reportsApp();
    const { reportId } = (await (
      await harness.post({ gameId: ids.game, buildHash: 'b'.repeat(64) })
    ).json()) as Created;
    const upload = (bytes: Uint8Array, user: string = ids.player, type = 'application/octet-stream') =>
      harness.app.request(`/api/v1/reports/${reportId}/bundle`, {
        method: 'POST',
        headers: { ...asUser(user), 'content-type': type },
        body: bytes,
      });
    const read = (user: string) => harness.app.request(`/api/v1/reports/${reportId}/bundle`, { headers: asUser(user) });
    return { ...harness, reportId, upload, read };
  }

  it('stores a bundle privately and signs reads for admins only', async () => {
    const { deps, reportId, upload, read } = await withReport();
    const response = await upload(new TextEncoder().encode('{"log":[]}'), ids.player, 'application/json');
    expect(response.status).toBe(201);
    const { bundleKey } = (await response.json()) as { bundleKey: string };
    expect(bundleKey).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(deps.db.select().from(schema.reports).where(eq(schema.reports.id, reportId)).get()?.bundleKey).toBe(
      bundleKey,
    );

    expect((await read(ids.owner)).status).toBe(403);
    expect((await read(ids.player)).status).toBe(403);
    const admin = await read(ids.admin);
    expect(admin.status).toBe(302);
    expect(admin.headers.get('location')).toMatch(/\/blobs\/sha256\/[0-9a-f]{64}\?exp=\d+&sig=/);
  });

  it('rejects a bundle over the limit with 413 and stores nothing', async () => {
    const { deps, upload, reportId } = await withReport();
    const put = vi.spyOn(deps.blobStore, 'put');
    expect((await upload(new Uint8Array(2 * 1024 * 1024 + 1))).status).toBe(413);
    expect(put).not.toHaveBeenCalled();
    expect(deps.db.select().from(schema.reports).where(eq(schema.reports.id, reportId)).get()?.bundleKey).toBeNull();
  });

  it('enforces the limit on chunked uploads without a Content-Length', async () => {
    const { app, deps, reportId } = await withReport();
    const put = vi.spyOn(deps.blobStore, 'put');
    const chunk = new Uint8Array(1024 * 1024);
    // Endless: buffering the whole body before checking its size would never return.
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk);
      },
    });
    const response = await app.request(`/api/v1/reports/${reportId}/bundle`, {
      method: 'POST',
      headers: { ...asUser(ids.player), 'content-type': 'application/octet-stream' },
      body,
      duplex: 'half',
    } as RequestInit);
    expect(response.status).toBe(413);
    expect(put).not.toHaveBeenCalled();
  });

  it('keeps the first bundle: a second upload is 409, also when both race', async () => {
    const { upload } = await withReport();
    const racing = await Promise.all([upload(new Uint8Array([1])), upload(new Uint8Array([2]))]);
    expect(racing.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await upload(new Uint8Array([3]))).status).toBe(409);
  });

  it('accepts bundles only from the reporter and only as octet-stream, json or gzip', async () => {
    const { upload } = await withReport();
    expect((await upload(new Uint8Array([1]), ids.owner)).status).toBe(403);
    expect((await upload(new Uint8Array([1]), ids.player, 'text/html')).status).toBe(415);
  });

  it('keeps the report and answers 201 without bundleKey when the blob store fails', async () => {
    const { deps, upload } = await withReport();
    vi.spyOn(deps.blobStore, 'put').mockRejectedValue(new Error('disk full'));
    const response = await upload(new Uint8Array([1, 2, 3]));
    expect(response.status).toBe(201);
    expect(await response.json()).not.toHaveProperty('bundleKey');
  });

  it("lists a game's reports to its owner and admins only", async () => {
    const { app } = await withReport();
    const list = (user: string) => app.request(`/api/v1/reports?gameId=${ids.game}`, { headers: asUser(user) });
    expect((await list(ids.player)).status).toBe(403);
    expect((await list(ids.admin)).status).toBe(200);
    const owner = await list(ids.owner);
    expect(owner.status).toBe(200);
    const { reports } = (await owner.json()) as { reports: { bundleKey?: string; hasBundle: boolean }[] };
    expect(reports).toHaveLength(1);
    expect(reports[0]).not.toHaveProperty('bundleKey');
  });

  it('shows the platform queue to admins only', async () => {
    const { app, post } = await reportsApp();
    await post(crash(ids.game, '@ogm/host/bridge.js'));
    const queue = (user: string) => app.request('/api/v1/reports/platform-queue', { headers: asUser(user) });
    expect((await queue(ids.owner)).status).toBe(403);
    const admin = await queue(ids.admin);
    expect(admin.status).toBe(200);
    expect(((await admin.json()) as { issues: unknown[] }).issues).toHaveLength(1);
  });
});
