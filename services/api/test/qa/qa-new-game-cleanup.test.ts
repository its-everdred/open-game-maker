import { eq } from 'drizzle-orm';
import { schema } from '@ogm/db';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createGameRow, provisionGame } from '../../src/games/games.js';
import { readQaState } from '../../src/qa/state.js';
import { INTERNAL_TOKEN, makeApp, makeDeps } from '../helpers.js';

describe('QA New Game cleanup', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('requires the internal credential, remote confirmation, exact folder and stopped jobs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ready: true }), { status: 200 })),
    );
    const deps = makeDeps();
    const { app } = await makeApp(deps);
    const headers = { 'content-type': 'application/json', 'x-ogm-internal': INTERNAL_TOKEN };
    const fencePath = '/internal/qa/create-fence/g_qa-fence-probe-test';
    const fenceBody = JSON.stringify({ owner: 'run-1' });
    expect((await app.request(fencePath, { method: 'POST', body: fenceBody })).status).toBe(401);
    expect(await (await app.request(fencePath, { method: 'POST', headers, body: fenceBody })).json()).toEqual({
      ready: true,
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      `${deps.config.commitInternalUrl}/internal/qa/create-fence/g_qa-fence-probe-test`,
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: `Bearer ${deps.config.commitServiceToken}` }),
      }),
    );
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ released: true }), { status: 200 }));
    expect(await (await app.request(fencePath, { method: 'DELETE', headers, body: fenceBody })).json()).toEqual({
      released: true,
    });
    await app.request('/internal/qa/session', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'qa@example.test' }),
    });
    const qa = readQaState(deps.db)!;
    const game = createGameRow(deps.db, {
      familyId: qa.familyId,
      ownerId: qa.userId,
      title: 'QA unfinished',
      repoVisibility: 'private',
    });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ terminal: true }), { status: 200 }));
    expect(await (await app.request(`/internal/qa/create-audit/${game.id}`, { headers })).json()).toEqual({
      terminal: true,
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      `${deps.config.commitInternalUrl}/internal/qa/create-audit/${game.id}`,
      expect.objectContaining({ method: 'GET' }),
    );
    const path = `/internal/qa/new-games/${game.id}`;
    type Ticket = { jobId: string; key: string; repo: string; issue: number };
    type Session = { id: string; jobId: string };
    const body = (jobs: string[] = [], tickets: Ticket[] = [], sessions: Session[] = []) =>
      JSON.stringify({
        folder: game.githubPath,
        jobs,
        tickets,
        sessions,
        remoteClean: true,
        daemonStopped: true,
        fenceOwner: 'run-1',
      });
    const remove = (jobs: string[] = [], tickets: Ticket[] = [], sessions: Session[] = []) =>
      app.request(path, { method: 'DELETE', headers, body: body(jobs, tickets, sessions) });
    const reportPath = `/internal/qa/new-games/${game.id}`;
    expect((await app.request('/internal/qa/new-games')).status).toBe(401);
    expect(await (await app.request('/internal/qa/new-games', { headers })).json()).toEqual({
      games: [{ id: game.id }],
      repo: 'instance/games',
    });
    expect((await app.request(reportPath)).status).toBe(401);
    expect(await (await app.request(reportPath, { headers })).json()).toMatchObject({ game: { id: game.id } });
    expect((await app.request(path, { method: 'DELETE' })).status).toBe(401);
    expect(
      (await app.request(`/internal/qa/new-games/${qa.gameId}`, { method: 'DELETE', headers, body: body() })).status,
    ).toBe(404);
    expect((await app.request(path, { method: 'DELETE', headers, body: '{}' })).status).toBe(400);
    deps.db
      .update(schema.games)
      .set({ repoUrl: 'https://example.test/repo' })
      .where(eq(schema.games.id, game.id))
      .run();
    expect(
      (
        await app.request(path, {
          method: 'DELETE',
          headers,
          body: JSON.stringify({
            folder: 'games/other',
            jobs: [],
            tickets: [],
            sessions: [],
            remoteClean: true,
            daemonStopped: true,
            fenceOwner: 'run-1',
          }),
        })
      ).status,
    ).toBe(409);
    deps.db.update(schema.games).set({ ownerId: 'another-user' }).where(eq(schema.games.id, game.id)).run();
    expect((await app.request(reportPath, { headers })).status).toBe(404);
    expect((await remove()).status).toBe(404);
    deps.db.update(schema.games).set({ ownerId: qa.userId }).where(eq(schema.games.id, game.id)).run();
    await app.request('/internal/qa/voice-fixtures', {
      method: 'POST',
      headers,
      body: JSON.stringify({ run: 'cleanup-test' }),
    });
    deps.db.update(schema.jobs).set({ gameId: game.id }).run();
    expect((await remove()).status).toBe(409);
    deps.db.update(schema.jobs).set({ state: 'cancelled' }).where(eq(schema.jobs.gameId, game.id)).run();
    expect((await remove()).status).toBe(409);
    expect((await remove(['j_qa-voice-cleanup-test'])).status).toBe(409);
    deps.db.update(schema.jobs).set({ kind: 'scope' }).where(eq(schema.jobs.gameId, game.id)).run();
    deps.db
      .insert(schema.gameDaemons)
      .values({
        slug: game.slug!,
        repo: 'instance/games',
        checkoutPath: '/tmp/qa',
        unit: 'qa.service',
        envFile: '/tmp/qa.env',
        port: 12345,
        status: 'running',
        createdAt: new Date().toISOString(),
      })
      .run();
    expect((await remove(['j_qa-voice-cleanup-test'])).status).toBe(409);
    deps.db.update(schema.gameDaemons).set({ status: 'stopped' }).where(eq(schema.gameDaemons.slug, game.slug!)).run();
    deps.db
      .update(schema.gameDaemons)
      .set({ repo: 'other/games' })
      .where(eq(schema.gameDaemons.slug, game.slug!))
      .run();
    expect((await remove(['j_qa-voice-cleanup-test'])).status).toBe(409);
    deps.db
      .update(schema.gameDaemons)
      .set({ repo: 'instance/games' })
      .where(eq(schema.gameDaemons.slug, game.slug!))
      .run();
    const ticket = { jobId: 'j_qa-voice-cleanup-test', key: 'scope', repo: 'instance/games', issue: 42 };
    deps.db
      .insert(schema.jobTickets)
      .values({ jobId: ticket.jobId, key: ticket.key, repo: ticket.repo, issueNumber: ticket.issue, sig: 'qa' })
      .run();
    expect((await remove([ticket.jobId])).status).toBe(409);
    deps.db.update(schema.games).set({ repoUrl: null }).where(eq(schema.games.id, game.id)).run();
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    deps.registry.repoProvisioner = {
      provision: async () => {
        await pending;
        throw new Error('failed');
      },
    };
    const provisioning = provisionGame(deps, game).catch(() => undefined);
    expect((await remove([ticket.jobId], [ticket])).status).toBe(409);
    finish();
    await provisioning;
    expect((await remove([ticket.jobId], [ticket])).status).toBe(409);
    deps.db
      .update(schema.games)
      .set({ repoUrl: 'https://github.com/instance/games' })
      .where(eq(schema.games.id, game.id))
      .run();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ready: false }), { status: 200 }));
    expect((await remove([ticket.jobId], [ticket])).status).toBe(409);
    const session = { id: 's_qa-real', jobId: ticket.jobId };
    deps.db
      .insert(schema.scopeSessions)
      .values({
        ...session,
        gameId: game.id,
        creatorId: qa.userId,
        status: 'open',
        revision: 0,
        choices: '{}',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .run();
    expect(await (await app.request(reportPath, { headers })).json()).toMatchObject({ sessions: [session] });
    expect((await remove([ticket.jobId], [ticket])).status).toBe(409);
    expect((await remove([ticket.jobId], [ticket], [session])).status).toBe(200);
    expect(
      deps.db.select().from(schema.gameDaemons).where(eq(schema.gameDaemons.slug, game.slug!)).get(),
    ).toBeUndefined();
    expect(deps.db.select().from(schema.games).where(eq(schema.games.id, game.id)).get()).toBeUndefined();
    const old = createGameRow(deps.db, {
      familyId: qa.familyId,
      ownerId: qa.userId,
      title: 'QA old',
      repoVisibility: 'private',
    });
    const oldPath = `/internal/qa/new-games/${old.id}`;
    const oldBody = JSON.stringify({
      folder: old.githubPath,
      jobs: [],
      tickets: [],
      sessions: [],
      remoteClean: true,
      daemonStopped: true,
      fenceOwner: 'legacy-123',
    });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ready: false }), { status: 200 }));
    expect((await app.request(oldPath, { method: 'DELETE', headers, body: oldBody })).status).toBe(409);
    expect((await app.request(oldPath, { method: 'DELETE', headers, body: oldBody })).status).toBe(200);
  });
});
