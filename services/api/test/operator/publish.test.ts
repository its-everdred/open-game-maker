import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { PUBLISH_ACTOR } from '../../src/operator/publish.js';
import operatorRoutes, { prefix as operatorPrefix } from '../../src/operator/routes.js';
import { builtFiles, ids, SHA, world } from '../builds/fixtures.js';
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

function publish(
  app: ReturnType<typeof operator>['app'],
  slug: string,
  sha: string,
  body: Buffer | string,
  headers: Record<string, string> = {},
) {
  return app.request(`${operatorPrefix}/games/${slug}/builds`, {
    method: 'POST',
    headers: { 'x-ogm-internal': INTERNAL_TOKEN, 'x-gm-sha': sha, 'content-type': 'application/gzip', ...headers },
    body,
  });
}

function buildRow(deps: ReturnType<typeof operator>['deps'], jobId: string) {
  return deps.db.select().from(schema.builds).where(eq(schema.builds.jobId, jobId)).get();
}

function branchRow(deps: ReturnType<typeof operator>['deps']) {
  return deps.db.select().from(schema.branches).where(eq(schema.branches.id, ids.main)).get()!;
}

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
    expect(await (await request()).json()).toEqual({ allowed: true });
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
