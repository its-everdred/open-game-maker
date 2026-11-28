import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ticketJobResolver } from '../../src/internal/ticket-job.js';
import { bundleRoutes, managedTicketAccess } from '../../src/internal/bundle.js';
import { mintPreviewToken } from '../../src/builds/preview-token.js';
import { createApp } from '../../src/app/app.js';
import { insertChatRow } from '../../src/build-chat/store.js';
import { ids, insertJob, worked } from '../budget/fixture.js';

it('resolves a filed child only in its game repository', async () => {
  const deps = worked();
  deps.db
    .update(schema.games)
    .set({ githubOwner: 'owner', githubRepo: 'games' })
    .where(eq(schema.games.id, ids.game))
    .run();
  insertJob(deps, { id: 'j_child', kind: 'feature', state: 'queued', aiurRepo: 'owner/games', aiurIssueNumber: 42 });
  deps.db
    .insert(schema.jobTickets)
    .values({ jobId: 'j_child', key: 'build', repo: 'owner/games', issueNumber: 42, sig: 'test' })
    .run();
  const resolve = ticketJobResolver(deps.db);
  expect(await resolve('OWNER/GAMES', '42')).toMatchObject({ jobId: 'j_child', gameId: ids.game, kind: 'feature' });
  expect(await resolve('other/games', '42')).toBeNull();
  expect(await resolve('owner/games', '43')).toBeNull();
  deps.db.update(schema.games).set({ githubRepo: 'moved' }).where(eq(schema.games.id, ids.game)).run();
  expect(await resolve('owner/games', '42')).toBeNull();
  deps.sqlite.close();
});

it('requires the ticket and workspace grant before serving private job data', async () => {
  const deps = worked();
  const home = mkdtempSync(join(tmpdir(), 'ogm-ticket-grant-'));
  const secret = 'fixture-secret';
  const grant = '12345678-1234-4234-8234-123456789abc';
  const hash = 'a'.repeat(64);
  deps.db
    .update(schema.games)
    .set({ githubOwner: 'owner', githubRepo: 'games', slug: 'castle' })
    .where(eq(schema.games.id, ids.game))
    .run();
  insertJob(deps, {
    id: 'j_child',
    idempotencyKey: 'planner:j_parent:one',
    aiurRepo: 'owner/games',
    aiurIssueNumber: 42,
    plan: JSON.stringify({ _plannerBase: { branch: 'ogm/checkpoint', sha: 'b'.repeat(40) } }),
  });
  deps.db
    .insert(schema.gameDaemons)
    .values({
      slug: 'castle',
      repo: 'owner/games',
      checkoutPath: '/fixture',
      unit: 'fixture',
      envFile: '/fixture',
      port: 4101,
      status: 'running',
      createdAt: '2026-11-01T00:00:00Z',
    })
    .run();
  const dir = join(home, '.config/ogm/daemons/castle');
  mkdirSync(join(dir, 'preview-grants'), { recursive: true });
  writeFileSync(join(dir, 'hook-secret'), secret);
  writeFileSync(
    join(dir, 'preview-grants', `${hash}.json`),
    JSON.stringify({ ticket: '42', game: 'castle', grant, expires: Date.now() + 600_000 }),
  );
  const app = createApp(deps);
  app.route(
    '/internal',
    bundleRoutes({
      daemonForSecret: async (value) => (value === secret ? 'owner/games' : null),
      ticketAccess: managedTicketAccess(home),
      skills: () => ({ version: 'test', tgz: Buffer.from('') }),
    }),
  );
  const get = (ticket: string, token?: string, workspace = hash) =>
    app.request(`http://localhost/internal/jobs/by-ticket/${ticket}/bundle`, {
      headers: { authorization: `Bearer ${secret}`, 'x-ogm-preview-token': token ?? '', 'x-ogm-workspace': workspace },
    });
  const token = mintPreviewToken(secret, '42', grant, 'castle');
  expect((await get('42')).status).toBe(404);
  expect((await get('42', token, 'b'.repeat(64))).status).toBe(404);
  expect((await get('43', token)).status).toBe(404);
  expect((await get('42', token)).status).toBe(200);
  writeFileSync(
    join(dir, 'preview-grants', `${hash}.json`),
    JSON.stringify({ ticket: '42', game: 'castle', grant, expires: Date.now() - 1 }),
  );
  expect((await get('42', token)).status).toBe(404);
  deps.sqlite.close();
});

it('guards a planner ticket and serves its current answers to its repository', async () => {
  const deps = worked();
  deps.db
    .update(schema.games)
    .set({ githubOwner: 'owner', githubRepo: 'games' })
    .where(eq(schema.games.id, ids.game))
    .run();
  insertJob(deps, { id: 'j_parent', kind: 'new_game' });
  insertJob(deps, {
    id: 'j_child',
    idempotencyKey: 'planner:j_parent:one',
    aiurRepo: 'owner/games',
    aiurIssueNumber: 42,
  });
  deps.db
    .insert(schema.jobTickets)
    .values({ jobId: 'j_child', key: 'build', repo: 'owner/games', issueNumber: 42, sig: 'test' })
    .run();
  insertChatRow(deps.sqlite, {
    jobId: 'j_parent',
    actor: 'agent',
    kind: 'command',
    command: {
      decision_id: 'decision',
      question: 'Which door?',
      options: [
        { id: 'a', label: 'Wood' },
        { id: 'b', label: 'Iron' },
      ],
      blocking: false,
      status: 'answered',
      option_id: 'a',
      corrected_option_id: 'b',
      corrections: 1,
    },
  });
  deps.registry.ticketJobResolver = ticketJobResolver(deps.db);
  const app = createApp(deps);
  app.route(
    '/internal',
    bundleRoutes({
      daemonForSecret: async (secret) => (secret === 'trusted' ? 'owner/games' : null),
      skills: () => ({ version: 'test', tgz: Buffer.from('') }),
    }),
  );
  const get = (path: string, token = 'trusted') =>
    app.request(`http://localhost/internal/jobs/by-ticket/${path}`, { headers: { authorization: `Bearer ${token}` } });
  expect(await (await get('42/planner-guard')).json()).toEqual({ plannerChild: true });
  deps.db.delete(schema.jobTickets).where(eq(schema.jobTickets.jobId, 'j_child')).run();
  expect(await (await get('42/planner-guard')).json()).toEqual({ plannerChild: true });
  expect(await (await get('43/planner-guard')).json()).toEqual({ plannerChild: false });
  expect(await (await get('42/planner-answers')).json()).toMatchObject({
    answers: [{ question: 'Which door?', answer: 'Iron' }],
  });
  expect((await get('42/planner-answers', 'other')).status).toBe(401);
  deps.sqlite.close();
});
