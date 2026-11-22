import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { cachePlanSchema, type CachePlan, type CachePlanEntry } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { blobPath } from '@ogm/games-host/layout';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { stageArtifact, publishStaged } from '../../src/builds/publish.js';
import { collectBuildArtifact } from '../../src/releases/gc.js';
import { ensureMainBranch } from '../../src/design/store.js';
import { builtFiles, completeRun, ids, SHA, world } from './fixtures.js';

const archiveOf = (dir: string) => execFileSync('tar', ['--format=ustar', '-czf', '-', '-C', dir, '.']);
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

function emptyTotals(): CachePlan['totals'] {
  const phases = () => ({
    boot: { bytes: 0, files: 0 },
    ready: { bytes: 0, files: 0 },
    stream: { bytes: 0, files: 0 },
  });
  return { desktop: phases(), mobile: phases(), low: phases() };
}

function cachedBuild(blobs: { bytes: Buffer; ext: 'mp3' | 'png'; kind: 'music' | 'sprite' }[]): string {
  const dir = builtFiles();
  mkdirSync(join(dir, 'a'), { recursive: true });
  const entries: CachePlanEntry[] = blobs.map(({ bytes, ext, kind }) => {
    const sha256 = digest(bytes);
    writeFileSync(join(dir, 'a', `${sha256}.${ext}`), bytes);
    return {
      sha256,
      url: `/a/${sha256}.${ext}`,
      bytes: bytes.length,
      kind,
      phase: kind === 'music' ? 'stream' : 'ready',
      tiers: ['*'],
    };
  });
  const totals = emptyTotals();
  for (const entry of entries) {
    totals.desktop[entry.phase].bytes += entry.bytes;
    totals.desktop[entry.phase].files += 1;
  }
  writeFileSync(
    join(dir, 'assets', 'cache-plan.json'),
    JSON.stringify({
      version: 1,
      gameId: '',
      buildId: '',
      built: '2026-11-02T20:00:00.000Z',
      sdkVersion: '',
      tiers: ['desktop'],
      entries,
      totals,
    }),
  );
  return dir;
}

function addJob(deps: ReturnType<typeof world>['deps'], jobId: string, gameId: string, ticket: string): void {
  const original = deps.db.select().from(schema.jobs).where(eq(schema.jobs.id, ids.job)).get()!;
  deps.db
    .insert(schema.jobs)
    .values({
      ...original,
      id: jobId,
      gameId,
      state: 'running',
      aiurRunId: null,
      aiurRepo: null,
      aiurIssueNumber: null,
      aiurSpendCapMicroUsd: null,
      idempotencyKey: null,
      terminalAt: null,
      releasedAt: null,
    })
    .run();
  deps.db
    .insert(schema.jobProjections)
    .values({
      jobId,
      daemonSlug: 'fixture',
      ticket,
      stage: 'final_tests',
      stageText: 'Final tests',
      lifecycle: 'completed',
      updatedAt: '2026-11-02T20:00:00.000Z',
    })
    .run();
}

async function publishFixture(
  deps: ReturnType<typeof world>['deps'],
  jobId: string,
  dir: string,
  sha: string,
): Promise<string> {
  await stageArtifact(deps, jobId, sha, archiveOf(dir));
  const outcome = await publishStaged(deps, jobId);
  expect(outcome).toMatchObject({ state: 'done' });
  return deps.db.select().from(schema.builds).where(eq(schema.builds.jobId, jobId)).get()!.id;
}

function plan(deps: ReturnType<typeof world>['deps'], gameId: string, buildId: string): CachePlan {
  return cachePlanSchema.parse(
    JSON.parse(readFileSync(join(deps.config.gamesRoot, gameId, buildId, 'assets', 'cache-plan.json'), 'utf8')),
  );
}

describe('published cache plans', () => {
  it('rewrites ./x, x and /x references to the same /a/ address once each (#1197)', async () => {
    const { deps } = world();
    completeRun(deps);
    const dir = cachedBuild([]);
    writeFileSync(
      join(dir, 'index.html'),
      '<!doctype html><script type="module" src="./assets/main.js"></script>' +
        '<link rel="modulepreload" href="assets/main.js"><link rel="preload" href="/assets/main.js">\n',
    );
    const buildId = await publishFixture(deps, ids.job, dir, SHA);
    const mainHash = digest(Buffer.from('console.log("fixture");\n'));
    const html = readFileSync(join(deps.config.gamesRoot, ids.game, buildId, 'index.html'), 'utf8');
    expect(html).not.toMatch(/\/\/a\//u);
    expect(html.match(new RegExp(`"/a/${mainHash}\\.js"`, 'gu'))).toHaveLength(3);
  });

  it('rewrites root-relative names inside bundles and never part of a longer path (#1197)', async () => {
    const { deps } = world();
    completeRun(deps);
    const dir = cachedBuild([]);
    const data = '{"sprites":[]}\n';
    writeFileSync(join(dir, 'assets', 'data.json'), data);
    // What Vite emits for `new URL('assets/data.json', document.baseURI)` in a chunk under assets/: every Dusk Helm
    // bundle became `assets//a/<hash>.json` and the game stuck on its loading layer.
    writeFileSync(
      join(dir, 'assets', 'main.js'),
      'fetch(new URL("assets/data.json",document.baseURI).href);fetch("data.json");' +
        'fetch("https://cdn.example/assets/data.json");\n',
    );
    const buildId = await publishFixture(deps, ids.job, dir, SHA);
    const address = `/a/${digest(Buffer.from(data))}.json`;
    const main = readFileSync(join(deps.config.gamesRoot, ids.game, buildId, 'assets', 'main.js'), 'utf8');
    expect(main).toBe(
      `fetch(new URL("${address}",document.baseURI).href);fetch("${address}");` +
        'fetch("https://cdn.example/assets/data.json");\n',
    );
  });

  it('deduplicates shared blobs, records branch lineage, and keeps hashes referenced by live builds', async () => {
    const { deps } = world();
    completeRun(deps);
    const sharedMusic = Buffer.from('shared music');
    const firstSprite = Buffer.from('first sprite');
    const secondSprite = Buffer.from('second sprite');
    const sharedHash = digest(sharedMusic);
    const firstHash = digest(firstSprite);
    const secondHash = digest(secondSprite);

    const firstBuild = await publishFixture(
      deps,
      ids.job,
      cachedBuild([
        { bytes: sharedMusic, ext: 'mp3', kind: 'music' },
        { bytes: firstSprite, ext: 'png', kind: 'sprite' },
      ]),
      SHA,
    );

    const secondJob = 'j_00000000-0000-4000-8000-000000000004';
    addJob(deps, secondJob, ids.game, '13');
    const secondBuild = await publishFixture(
      deps,
      secondJob,
      cachedBuild([
        { bytes: sharedMusic, ext: 'mp3', kind: 'music' },
        { bytes: secondSprite, ext: 'png', kind: 'sprite' },
      ]),
      'f'.repeat(40),
    );

    const otherGame = 'g_00000000-0000-4000-8000-000000000099';
    deps.db
      .insert(schema.games)
      .values({
        id: otherGame,
        familyId: ids.family,
        ownerId: ids.user,
        title: 'Other game',
        visibility: 'private',
        repoVisibility: 'private',
        createdAt: '2026-11-02T20:00:00.000Z',
      })
      .run();
    ensureMainBranch(deps.sqlite, otherGame, {
      id: 'b_01H7KMW81X8QF3B2N5D6V9C0AZ',
      now: new Date('2026-11-02T20:00:00.000Z'),
    });
    const otherJob = 'j_00000000-0000-4000-8000-000000000005';
    addJob(deps, otherJob, otherGame, '14');
    const otherBuild = await publishFixture(
      deps,
      otherJob,
      cachedBuild([{ bytes: sharedMusic, ext: 'mp3', kind: 'music' }]),
      'd'.repeat(40),
    );

    const stored = readdirSync(join(deps.config.gamesRoot, '_a'));
    expect(stored).toEqual(expect.arrayContaining([`${firstHash}.png`, `${secondHash}.png`, `${sharedHash}.mp3`]));
    for (const [gameId, buildId] of [
      [ids.game, firstBuild],
      [ids.game, secondBuild],
      [otherGame, otherBuild],
    ]) {
      expect(existsSync(join(deps.config.gamesRoot, gameId, buildId, 'a'))).toBe(false);
    }

    const firstPlan = plan(deps, ids.game, firstBuild);
    const secondPlan = plan(deps, ids.game, secondBuild);
    const otherPlan = plan(deps, otherGame, otherBuild);
    expect(firstPlan).toMatchObject({ gameId: ids.game, buildId: firstBuild, sdkVersion: '^1.0.0' });
    expect(firstPlan.lineage).toBeUndefined();
    const firstCode = firstPlan.entries.filter(({ kind }) => kind === 'code');
    const secondCode = secondPlan.entries.filter(({ kind }) => kind === 'code');
    const mainHash = digest(Buffer.from('console.log("fixture");\n'));
    expect(firstCode.find(({ sourcePath }) => sourcePath === 'assets/main.js')?.url).toBe(`/a/${mainHash}.js`);
    const indexPath = join(deps.config.gamesRoot, ids.game, firstBuild, 'index.html');
    const indexBytes = readFileSync(indexPath);
    const indexEntry = firstCode.find(({ sourcePath }) => sourcePath === 'index.html');
    expect(indexEntry?.url).toBe(`/a/${digest(indexBytes)}.html`);
    expect(secondCode.find(({ sourcePath }) => sourcePath === 'index.html')?.url).toBe(indexEntry?.url);
    const indexHtml = readFileSync(join(deps.config.gamesRoot, ids.game, firstBuild, 'index.html'), 'utf8');
    // `./assets/main.js` must become `/a/<hash>.js`, not `.//a/<hash>.js` (#1197: every prod game's entry 404ed).
    expect(indexHtml).toContain(`src="/a/${mainHash}.js"`);
    expect(indexHtml).not.toMatch(/\/\/a\//u);
    expect(secondPlan.lineage).toEqual({
      previousBuildId: firstBuild,
      added: [secondHash],
      removed: [firstHash],
      addedBytes: { desktop: secondSprite.length, mobile: 0, low: 0 },
    });
    expect(otherPlan).toMatchObject({ gameId: otherGame, buildId: otherBuild });
    expect(otherPlan.lineage).toBeUndefined();

    await collectBuildArtifact(deps, firstBuild);
    expect(existsSync(blobPath(deps.config.gamesRoot, `${sharedHash}.mp3`))).toBe(true);
    expect(existsSync(blobPath(deps.config.gamesRoot, `${secondHash}.png`))).toBe(true);
    expect(existsSync(blobPath(deps.config.gamesRoot, `${firstHash}.png`))).toBe(false);
  });

  it('refuses bytes that do not match their content address before publishing the build', async () => {
    const { deps } = world();
    completeRun(deps);
    const dir = cachedBuild([{ bytes: Buffer.from('expected'), ext: 'png', kind: 'sprite' }]);
    const [file] = readdirSync(join(dir, 'a'));
    writeFileSync(join(dir, 'a', file!), 'different');

    await stageArtifact(deps, ids.job, SHA, archiveOf(dir));
    await expect(publishStaged(deps, ids.job)).resolves.toEqual({
      state: 'failed',
      reason: 'cache_plan_assets_mismatch',
    });
    expect(existsSync(join(deps.config.gamesRoot, '_a'))).toBe(false);
  });

  it('serializes lineage through concurrent branch publishes', async () => {
    const { deps } = world();
    completeRun(deps);
    const seedBuild = await publishFixture(
      deps,
      ids.job,
      cachedBuild([{ bytes: Buffer.from('seed'), ext: 'png', kind: 'sprite' }]),
      SHA,
    );
    const secondJob = 'j_00000000-0000-4000-8000-000000000006';
    const thirdJob = 'j_00000000-0000-4000-8000-000000000007';
    addJob(deps, secondJob, ids.game, '15');
    addJob(deps, thirdJob, ids.game, '16');
    await Promise.all([
      stageArtifact(
        deps,
        secondJob,
        'a'.repeat(40),
        archiveOf(cachedBuild([{ bytes: Buffer.from('second'), ext: 'png', kind: 'sprite' }])),
      ),
      stageArtifact(
        deps,
        thirdJob,
        'b'.repeat(40),
        archiveOf(cachedBuild([{ bytes: Buffer.from('third'), ext: 'png', kind: 'sprite' }])),
      ),
    ]);

    await expect(Promise.all([publishStaged(deps, secondJob), publishStaged(deps, thirdJob)])).resolves.toEqual([
      expect.objectContaining({ state: 'done' }),
      expect.objectContaining({ state: 'done' }),
    ]);

    const secondBuild = deps.db.select().from(schema.builds).where(eq(schema.builds.jobId, secondJob)).get()!.id;
    const thirdBuild = deps.db.select().from(schema.builds).where(eq(schema.builds.jobId, thirdJob)).get()!.id;
    const latestBuild = deps.db.select().from(schema.branches).where(eq(schema.branches.id, ids.main)).get()!
      .latestBuildId!;
    const priorConcurrentBuild = latestBuild === secondBuild ? thirdBuild : secondBuild;
    expect(plan(deps, ids.game, priorConcurrentBuild).lineage?.previousBuildId).toBe(seedBuild);
    expect(plan(deps, ids.game, latestBuild).lineage?.previousBuildId).toBe(priorConcurrentBuild);
  });
});
