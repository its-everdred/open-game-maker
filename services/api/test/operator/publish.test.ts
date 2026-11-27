import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { PUBLISH_ACTOR } from '../../src/operator/publish.js';
import { listCheckRecords } from '../../src/builds/check-records.js';
import operatorRoutes, { prefix as operatorPrefix } from '../../src/operator/routes.js';
import { builtFiles, CHECK_ID, ids, SHA, world } from '../builds/fixtures.js';
import { INTERNAL_TOKEN } from '../helpers.js';
import { answerRound, postRound } from '../../src/review-rounds/store.js';

const NEWER_SHA = 'f'.repeat(40);

const archiveOf = (dir: string) => execFileSync('tar', ['--format=ustar', '-czf', '-', '-C', dir, '.']);

// The operator's route on the production app, beside the hook's upload route the fixtures already mount.
function operator() {
  const fixture = world();
  fixture.app.route(operatorPrefix, operatorRoutes);
  return fixture;
}

async function publish(
  app: ReturnType<typeof operator>['app'],
  slug: string,
  sha: string,
  body: Buffer | string,
  headers: Record<string, string> = {},
) {
  let checkId = sha === NEWER_SHA ? 'pc_newer' : CHECK_ID;
  if (/^[0-9a-f]{40}$/.test(sha)) {
    const record = await app.request(`${operatorPrefix}/games/${slug}/publish-checks`, {
      method: 'POST',
      headers: { 'x-ogm-internal': INTERNAL_TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({
        gitSha: sha,
        artifactSha256: createHash('sha256').update(body).digest('hex'),
        surface: 'game',
        sizes: [],
        checks: [
          { name: 'pnpm run build', result: 'passed' },
          { name: 'pnpm run test', result: 'passed' },
        ],
      }),
    });
    if (record.ok) checkId = ((await record.json()) as { id: string }).id;
  }
  return app.request(`${operatorPrefix}/games/${slug}/builds`, {
    method: 'POST',
    headers: {
      'x-ogm-internal': INTERNAL_TOKEN,
      'x-gm-sha': sha,
      'x-gm-check-id': checkId,
      'content-type': 'application/gzip',
      ...headers,
    },
    body,
  });
}

function buildRow(deps: ReturnType<typeof operator>['deps'], jobId: string) {
  return deps.db.select().from(schema.builds).where(eq(schema.builds.jobId, jobId)).get();
}

function branchRow(deps: ReturnType<typeof operator>['deps']) {
  return deps.db.select().from(schema.branches).where(eq(schema.branches.id, ids.main)).get()!;
}

it('reports whether a prototype review round exists for a build SHA', async () => {
  const { app, deps } = operator();
  const lookup = (sha: string, headers = { 'x-ogm-internal': INTERNAL_TOKEN }) =>
    app.request(`${operatorPrefix}/games/castle-game/review-sha/${sha}`, { headers });
  expect(await (await lookup(SHA)).json()).toEqual({ recorded: false });
  expect((await app.request(`${operatorPrefix}/games/castle-game/review-sha/${SHA}`)).status).toBe(401);
  postRound(deps.db, {
    id: 'prototype-review',
    gameId: ids.game,
    track: 'art',
    phase: 'concept',
    category: 'art',
    round: 1,
    ticket: '42',
    sha: SHA,
    media: '[]',
    postedAt: '2026-01-01T00:00:00Z',
  });
  expect(await (await lookup(SHA)).json()).toEqual({ recorded: true });
  expect((await lookup('invalid')).status).toBe(400);
});

describe('operator review stalls', () => {
  it('requires the internal credential', async () => {
    const { app } = operator();
    expect((await app.request(`${operatorPrefix}/review-stalls`)).status).toBe(401);
    const response = await app.request(`${operatorPrefix}/review-stalls`, {
      headers: { 'x-ogm-internal': INTERNAL_TOKEN },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ worker: [], creator: [], missing: [] });
  });
});

it('fetches a remote-only review commit and reports an unknown commit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ogm-close-fetch-'));
  const remote = join(root, 'remote');
  const checkout = join(root, 'checkout');
  try {
    mkdirSync(remote);
    const git = (dir: string, ...args: string[]) =>
      execFileSync('git', ['-C', dir, '-c', 'user.name=test', '-c', 'user.email=test@example.test', ...args])
        .toString()
        .trim();
    git(remote, 'init', '-q');
    git(remote, 'commit', '--allow-empty', '-qm', 'initial');
    execFileSync('git', ['clone', '-q', remote, checkout]);
    mkdirSync(join(remote, 'games/castle-game/review/tracks'), { recursive: true });
    writeFileSync(
      join(remote, 'games/castle-game/review/tracks/art.json'),
      JSON.stringify({ id: 'art', category: 'art', phases: [{ id: 'concept', ticket: '42', template: 'art' }] }),
    );
    git(remote, 'add', 'games');
    git(remote, 'commit', '-qm', 'track');
    const sha = git(remote, 'rev-parse', 'HEAD');
    const { app, deps } = operator();
    deps.db
      .update(schema.games)
      .set({ githubOwner: 'owner', githubRepo: 'repo' })
      .where(eq(schema.games.id, ids.game))
      .run();
    deps.db
      .insert(schema.gameDaemons)
      .values({
        slug: 'castle-game',
        repo: 'owner/repo',
        checkoutPath: checkout,
        unit: 'fixture',
        envFile: '/fixture',
        port: 23456,
        status: 'running',
        createdAt: '2026-01-01T00:00:00Z',
      })
      .run();
    const request = (revision: string) =>
      app.request(`${operatorPrefix}/games/castle-game/review-close/42?sha=${revision}`, {
        headers: { 'x-ogm-internal': INTERNAL_TOKEN },
      });
    const fetched = await request(sha);
    expect(fetched.status).toBe(200);
    expect(await fetched.json()).toEqual({ allowed: false });
    const unknown = await request('f'.repeat(40));
    expect(unknown.status).toBe(409);
    expect(await unknown.json()).toEqual({ error: 'unknown_commit' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('allows host closure only after an owned phase is approved', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ogm-close-gate-'));
  try {
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.test', ...args])
        .toString()
        .trim();
    git('init', '-q');
    mkdirSync(join(root, 'games/castle-game/review/tracks'), { recursive: true });
    writeFileSync(
      join(root, 'games/castle-game/review/tracks/art.json'),
      JSON.stringify({ id: 'art', category: 'art', phases: [{ id: 'concept', ticket: '42', template: 'art' }] }),
    );
    git('add', 'games');
    git('commit', '-qm', 'track');
    const sha = git('rev-parse', 'HEAD');
    const { app, deps } = operator();
    deps.db
      .update(schema.games)
      .set({ githubOwner: 'owner', githubRepo: 'repo' })
      .where(eq(schema.games.id, ids.game))
      .run();
    deps.db
      .insert(schema.gameDaemons)
      .values({
        slug: 'castle-game',
        repo: 'owner/repo',
        checkoutPath: root,
        unit: 'fixture',
        envFile: '/fixture',
        port: 23456,
        status: 'running',
        createdAt: '2026-01-01T00:00:00Z',
      })
      .run();
    const request = () =>
      app.request(`${operatorPrefix}/games/castle-game/review-close/42?sha=${sha}`, {
        headers: { 'x-ogm-internal': INTERNAL_TOKEN },
      });
    expect(await (await request()).json()).toEqual({ allowed: false });
    postRound(deps.db, {
      id: 'r',
      gameId: ids.game,
      track: 'art',
      phase: 'concept',
      category: 'art',
      round: 1,
      ticket: '42',
      sha,
      media: '[]',
      postedAt: '2026-01-01T00:00:00Z',
    });
    answerRound(deps.db, ids.game, 'r', {
      verdict: 'approved',
      notes: null,
      source: 'preview',
      at: '2026-01-01T01:00:00Z',
    });
    expect(await (await request()).json()).toEqual({ allowed: false });
    deps.db
      .insert(schema.reviewDispatchIntents)
      .values({ roundId: 'r', ticket: '42', state: 'consumed', createdAt: '2026-01-01' })
      .run();
    expect(await (await request()).json()).toEqual({ allowed: true });
    writeFileSync(
      join(root, 'games/castle-game/review/tracks/sound.json'),
      JSON.stringify({ id: 'sound', category: 'sound', phases: [{ id: 'cue', ticket: '42', template: 'sound' }] }),
    );
    git('add', 'games');
    git('commit', '-qm', 'add sound track');
    expect(await (await request()).json()).toEqual({ allowed: false });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('operator publish', () => {
  it('describes a registered game so the host script knows where to build', async () => {
    const { app } = operator();
    const response = await app.request(`${operatorPrefix}/games/castle-game`, {
      headers: { 'x-ogm-internal': INTERNAL_TOKEN },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      game: { id: ids.game, slug: 'castle-game', repo: { path: 'games/castle-game' } },
      daemon: null,
      branch: { name: 'main', latestBuildId: null },
      build: null,
    });
  });

  it('refuses a caller without the internal token and a game that is not registered', async () => {
    const { app } = operator();
    expect((await app.request(`${operatorPrefix}/games/castle-game`)).status).toBe(401);
    const unknown = await app.request(`${operatorPrefix}/games/nope`, {
      headers: { 'x-ogm-internal': INTERNAL_TOKEN },
    });
    expect(unknown.status).toBe(404);
    expect((await publish(app, 'nope', SHA, archiveOf(builtFiles()))).status).toBe(404);
  });

  it('refuses a body without a 40-character SHA', async () => {
    const { app, deps } = operator();
    const response = await publish(app, 'castle-game', 'main', archiveOf(builtFiles()));
    expect(response.status).toBe(400);
    expect(deps.db.select().from(schema.builds).all()).toEqual([]);
  });

  it('stages and publishes a build as the next build on main, settled as a finished system job', async () => {
    const { app, deps } = operator();
    const response = await publish(app, 'castle-game', SHA, archiveOf(builtFiles()));
    expect(response.status).toBe(201);
    const body = (await response.json()) as { state: string; jobId: string; buildId: string };
    expect(body.state).toBe('done');
    const lookup = await app.request(`${operatorPrefix}/games/castle-game/builds/${body.jobId}`, {
      headers: { 'x-ogm-internal': INTERNAL_TOKEN },
    });
    expect(await lookup.json()).toEqual({ state: 'done', buildId: body.buildId, publishResult: 'skipped' });
    expect((await app.request(`${operatorPrefix}/games/castle-game/builds/${body.jobId}`)).status).toBe(401);

    const build = buildRow(deps, body.jobId);
    expect(build).toMatchObject({ id: body.buildId, gameId: ids.game, gitSha: SHA, status: 'tested' });
    expect(branchRow(deps).latestBuildId).toBe(body.buildId);
    expect(existsSync(join(deps.config.gamesRoot, ids.game, body.buildId, '.complete'))).toBe(true);

    const job = deps.db.select().from(schema.jobs).where(eq(schema.jobs.id, body.jobId)).get()!;
    expect(job).toMatchObject({ kind: 'feature', state: 'done', branchId: 'main' });
    // The publish is settled before the request returns, so it never holds a family's job slot afterwards.
    expect(job.releasedAt).not.toBeNull();
  });

  it('publishes the next build when it runs again for a newer SHA, and keeps the earlier build', async () => {
    const { app, deps } = operator();
    const first = (await (await publish(app, 'castle-game', SHA, archiveOf(builtFiles()))).json()) as {
      buildId: string;
      jobId: string;
    };
    const second = (await (await publish(app, 'castle-game', NEWER_SHA, archiveOf(builtFiles()))).json()) as {
      buildId: string;
      jobId: string;
    };

    expect(second.buildId).not.toBe(first.buildId);
    expect(buildRow(deps, second.jobId)).toMatchObject({ gitSha: NEWER_SHA, status: 'tested' });
    expect(branchRow(deps).latestBuildId).toBe(second.buildId);
    expect(existsSync(join(deps.config.gamesRoot, ids.game, first.buildId, '.complete'))).toBe(true);
  });

  it('publishes one build when two uploads race for the same game', async () => {
    const { app, deps } = operator();
    const [first, second] = await Promise.all([
      publish(app, 'castle-game', SHA, archiveOf(builtFiles())),
      publish(app, 'castle-game', NEWER_SHA, archiveOf(builtFiles())),
    ]);

    expect([first.status, second.status]).toEqual([201, 201]);
    const builds = deps.db.select().from(schema.builds).all();
    expect(builds).toHaveLength(2);
    expect(builds.map((build) => build.status)).toEqual(['tested', 'tested']);
    expect(branchRow(deps).latestBuildId).not.toBeNull();
  });

  it('records one idempotent prototype review for a published build', async () => {
    const { app, deps } = operator();
    const published = (await (await publish(app, 'castle-game', SHA, archiveOf(builtFiles()))).json()) as {
      buildId: string;
    };
    expect(deps.db.select().from(schema.builds).get()).toMatchObject({ prototypeReviewState: 'pending' });
    const pendingGaps = await app.request(`${operatorPrefix}/prototype-review-gaps`, {
      headers: { 'x-ogm-internal': INTERNAL_TOKEN },
    });
    expect(await pendingGaps.json()).toEqual({ gaps: [{ slug: 'castle-game', buildId: published.buildId }] });
    const submission = {
      id: 'd9428888-122b-4b0e-b1c8-9f7900000001',
      track: 'prototype-publish',
      phase: 'build',
      category: 'gameplay',
      ticket: '42',
      sourceTickets: ['42', '43'],
      sha: SHA,
      media: [{ kind: 'build', ref: published.buildId }],
      question: 'Try the published build',
      works: ['Walk around'],
      limitations: ['No attack yet'],
      decisionIds: ['enemy-lineup'],
      clipStatus: 'unchecked',
    };
    const post = (body: unknown) =>
      app.request(`${operatorPrefix}/games/castle-game/prototype-reviews`, {
        method: 'POST',
        headers: { 'x-ogm-internal': INTERNAL_TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const first = await post(submission);
    expect(first.status).toBe(201);
    const firstResult = (await first.json()) as { id: string; round: number; state: string };
    expect(firstResult).toMatchObject({ round: 1, state: 'posted' });
    const retry = await post({ ...submission, id: 'd9428888-122b-4b0e-b1c8-9f7900000002' });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ id: firstResult.id, round: 1, state: 'existing' });
    expect(deps.db.select().from(schema.reviewRounds).all()).toHaveLength(1);
    expect(deps.db.select().from(schema.reviewRounds).get()).toMatchObject({
      works: '["Walk around"]',
      limitations: '["No attack yet"]',
      decisionIds: '["enemy-lineup"]',
      sourceTickets: '["42","43"]',
      clipStatus: 'unchecked',
    });
    expect(deps.db.select().from(schema.builds).get()).toMatchObject({ prototypeReviewState: 'posted' });
    const clearedGaps = await app.request(`${operatorPrefix}/prototype-review-gaps`, {
      headers: { 'x-ogm-internal': INTERNAL_TOKEN },
    });
    expect(await clearedGaps.json()).toEqual({ gaps: [] });
  });

  it('records an explicit no-round disposition so reconciliation does not alert', async () => {
    const { app, deps } = operator();
    const published = (await (await publish(app, 'castle-game', SHA, archiveOf(builtFiles()))).json()) as {
      buildId: string;
    };
    const response = await app.request(
      `${operatorPrefix}/games/castle-game/builds/${published.buildId}/prototype-review-check`,
      { method: 'POST', headers: { 'x-ogm-internal': INTERNAL_TOKEN } },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: 'none' });
    expect(deps.db.select().from(schema.builds).get()).toMatchObject({ prototypeReviewState: 'none' });
    const gaps = await app.request(`${operatorPrefix}/prototype-review-gaps`, {
      headers: { 'x-ogm-internal': INTERNAL_TOKEN },
    });
    expect(await gaps.json()).toEqual({ gaps: [] });
  });

  it('refuses an archive it cannot unpack and leaves no unfinished job behind', async () => {
    const { app, deps } = operator();
    const response = await publish(app, 'castle-game', SHA, Buffer.from('not a gzip archive'));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: 'archive_not_gzip' } });
    expect(deps.db.select().from(schema.builds).all()).toEqual([]);
    expect(branchRow(deps).latestBuildId).toBeNull();
    const jobs = deps.db.select().from(schema.jobs).all();
    expect(jobs.filter((job) => job.creatorId === PUBLISH_ACTOR).map((job) => job.state)).toEqual(['failed']);
  });

  it('fails the publish and the job when the archive carries no valid manifest', async () => {
    const { app, deps } = operator();
    const response = await publish(app, 'castle-game', SHA, archiveOf(builtFiles(undefined, { manifest: false })));
    expect(response.status).toBe(422);
    expect((await response.json()) as { state: string; reason: string }).toMatchObject({
      state: 'failed',
      reason: 'manifest_invalid',
    });
    expect(deps.db.select().from(schema.builds).all()).toEqual([]);
    expect(branchRow(deps).latestBuildId).toBeNull();
  });
});

it('records app checks separately from game checks and requires the operator credential', async () => {
  const { app, deps } = operator();
  const body = JSON.stringify({
    gitSha: SHA,
    artifactSha256: 'a'.repeat(64),
    surface: 'app',
    recordId: '6d9d5954-835c-45a3-bf61-352313e209e3',
    attemptedAt: '2026-11-27T00:00:00.000Z',
    sizes: ['390x844'],
    checks: [{ name: 'app load', result: 'passed' }],
    publishResult: 'published',
  });
  expect(
    (
      await app.request(`${operatorPrefix}/app/publish-checks`, {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json' },
      })
    ).status,
  ).toBe(401);
  const response = await app.request(`${operatorPrefix}/app/publish-checks`, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', 'x-ogm-internal': INTERNAL_TOKEN },
  });
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  const retry = await app.request(`${operatorPrefix}/app/publish-checks`, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', 'x-ogm-internal': INTERNAL_TOKEN },
  });
  expect(await retry.json()).toMatchObject({ id });
  const conflict = await app.request(`${operatorPrefix}/app/publish-checks`, {
    method: 'POST',
    body: JSON.stringify({ ...JSON.parse(body), gitSha: 'f'.repeat(40) }),
    headers: { 'content-type': 'application/json', 'x-ogm-internal': INTERNAL_TOKEN },
  });
  expect(conflict.status).toBe(409);
  expect(deps.db.select().from(schema.publishChecks).where(eq(schema.publishChecks.id, id)).all()).toHaveLength(1);
  const row = deps.db.select().from(schema.publishChecks).where(eq(schema.publishChecks.id, id)).get();
  expect(row).toMatchObject({ gameId: null, surface: 'app', publishResult: 'published', sizesJson: '["390x844"]' });
  expect(listCheckRecords(deps, ids.game)).toContainEqual(expect.objectContaining({ id, surface: 'app' }));
});

it('recovers queued app checks independently and orders them by attempt time', async () => {
  const { drainAppCheckQueue } = await import('../../src/builds/app-check-queue.js');
  const { deps } = operator();
  const dir = mkdtempSync(join(tmpdir(), 'app-check-recovery-'));
  const base = {
    gitSha: SHA,
    artifactSha256: 'a'.repeat(64),
    surface: 'app',
    sizes: [],
    checks: [{ name: 'load', result: 'passed' }],
    publishResult: 'published',
  };
  try {
    for (const [recordId, attemptedAt] of [
      ['6d9d5954-835c-45a3-bf61-352313e209e3', '2026-11-27T00:00:00.000Z'],
      ['0d9d5954-835c-45a3-bf61-352313e209e3', '2026-11-28T00:00:00.000Z'],
    ]) {
      writeFileSync(join(dir, `${recordId}.json`), JSON.stringify({ ...base, recordId, attemptedAt }));
    }
    await Promise.all([drainAppCheckQueue(deps, dir), drainAppCheckQueue(deps, dir)]);
    const records = listCheckRecords(deps, ids.game).filter((record) => record.surface === 'app');
    expect(records.map((record) => record.createdAt)).toEqual(['2026-11-28T00:00:00.000Z', '2026-11-27T00:00:00.000Z']);
    expect((await import('node:fs')).readdirSync(dir)).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
