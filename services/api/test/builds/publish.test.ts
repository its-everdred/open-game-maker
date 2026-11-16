import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

import { schema } from '@ogm/db';
import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

import { finishRun, publishStaged, sweepBuilds } from '../../src/builds/publish.js';
import { getDesignRuntime } from '../../src/design/routes.js';
import { appendTransaction, resolveBranch } from '../../src/design/store.js';
import { BadArchive, untarGz } from '../../src/builds/untar.js';
import { tarGz } from '../../src/internal/tarball.js';
import { builtFiles, completeRun, gamesHost, ids, jobState, SECRET, SHA, TICKET, world } from './fixtures.js';

const archiveOf = (dir: string) => execFileSync('tar', ['--format=ustar', '-czf', '-', '-C', dir, '.']);

function upload(app: ReturnType<typeof world>['app'], body: Buffer, headers: Record<string, string> = {}) {
  return app.request(`http://127.0.0.1:4000/internal/jobs/by-ticket/${TICKET}/build`, {
    method: 'POST',
    headers: { authorization: `Bearer ${SECRET}`, 'x-gm-sha': SHA, 'content-type': 'application/gzip', ...headers },
    body,
  });
}

function builds(deps: ReturnType<typeof world>['deps']) {
  return deps.db.select().from(schema.builds).all();
}

function latestBuildId(deps: ReturnType<typeof world>['deps']) {
  return deps.sqlite
    .prepare<[string], { latest_build_id: string | null }>('SELECT latest_build_id FROM branches WHERE id = ?')
    .get(ids.main)?.latest_build_id;
}

describe('publishing a merged build', () => {
  it('serves the build, marks it tested and points the branch at it when the upload follows the merge', async () => {
    const { deps, app } = world();
    completeRun(deps);

    const response = await upload(app, archiveOf(builtFiles()));
    expect(response.status).toBe(201);
    const { buildId } = (await response.json()) as { buildId: string };

    const [build] = builds(deps);
    expect(build).toMatchObject({ id: buildId, jobId: ids.job, gitSha: SHA, status: 'tested', sdkVersion: '^1.0.0' });
    expect(build!.artifactPath).toBe(join(deps.config.gamesRoot, ids.game, buildId));
    expect(latestBuildId(deps)).toBe(buildId);
    expect(jobState(deps)).toBe('done');
    // Draft reads the branch's design log: its head is the switch to this build.
    const head = deps.sqlite
      .prepare<[string], { base_build_id: string }>(
        'SELECT base_build_id FROM design_transactions WHERE branch_id = ? ORDER BY rev DESC LIMIT 1',
      )
      .get(ids.main);
    expect(head?.base_build_id).toBe(buildId);

    const host = await gamesHost(deps.config.gamesRoot);
    try {
      const page = await fetch(`${host.base}/g/${ids.game}/${buildId}/`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('<title>Fixture</title>');
      expect((await fetch(`${host.base}/g/${ids.game}/${buildId}/assets/main.js`)).status).toBe(200);
    } finally {
      await host.close();
    }
  });

  it('stages an upload that lands before the merge and publishes it when the run completes', async () => {
    const { deps, app } = world();

    const response = await upload(app, archiveOf(builtFiles()));
    expect(response.status).toBe(202);
    expect(builds(deps)).toEqual([]);
    expect(existsSync(join(deps.config.gamesRoot, ids.game))).toBe(false);
    expect(jobState(deps)).toBe('running');

    // What main.ts does when the feed reports the run completed.
    const outcome = await publishStaged(deps, ids.job);
    expect(outcome).toMatchObject({ state: 'done' });
    expect(jobState(deps)).toBe('done');
    expect(readdirSync(join(deps.config.gamesRoot, '.staging'))).toEqual([]);
  });

  it('fails the job with the reason and leaves nothing complete when the build has no manifest', async () => {
    const { deps, app } = world();
    completeRun(deps);

    const response = await upload(app, archiveOf(builtFiles(undefined, { manifest: false, design: true })));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ state: 'failed', reason: 'manifest_invalid' });
    expect(jobState(deps)).toBe('failed');
    expect(existsSync(join(deps.config.gamesRoot, ids.game))).toBe(false);
    expect(deps.lines).toContainEqual(
      expect.objectContaining({ event: 'build_publish_failed', reason: 'manifest_invalid' }),
    );
  });

  it('publishes display metadata from a large valid manifest', async () => {
    const { deps, app } = world();
    completeRun(deps);
    const dir = builtFiles();
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify({
        ...manifest,
        logo: 'media/logo.png',
        genres: ['puzzle'],
        loading: { portrait: 'media/p.png', landscape: 'media/l.png' },
        padding: 'x'.repeat(1024 * 1024),
      }),
    );
    const response = await upload(app, archiveOf(dir));
    expect(response.status).toBe(201);
    const { buildId } = (await response.json()) as { buildId: string };
    expect(
      JSON.parse(readFileSync(join(deps.config.gamesRoot, ids.game, buildId, '.ogm-display.json'), 'utf8')),
    ).toMatchObject({
      logo: 'media/logo.png',
      genres: ['puzzle'],
      loading: { portrait: 'media/p.png', landscape: 'media/l.png' },
    });
  });

  it('generates display variants after publishing a build', async () => {
    const { deps, app } = world();
    completeRun(deps);
    const dir = builtFiles();
    mkdirSync(join(dir, 'media'), { recursive: true });
    await sharp({ create: { width: 640, height: 360, channels: 3, background: '#f00' } })
      .png()
      .toFile(join(dir, 'media/thumbnail.png'));
    for (const name of ['p.png', 'l.png'])
      await sharp({ create: { width: 320, height: 180, channels: 3, background: '#0f0' } })
        .png()
        .toFile(join(dir, 'media', name));
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify({ ...manifest, loading: { portrait: 'media/p.png', landscape: 'media/l.png' } }),
    );
    const response = await upload(app, archiveOf(dir));
    expect(response.status).toBe(201);
    const { buildId } = (await response.json()) as { buildId: string };
    const build = join(deps.config.gamesRoot, ids.game, buildId);
    const display = await vi.waitFor(
      () => {
        const metadata = JSON.parse(readFileSync(join(build, '.ogm-display.json'), 'utf8'));
        expect(metadata.images?.['media/thumbnail.png']).toBeDefined();
        return metadata;
      },
      { timeout: 30_000 },
    );
    const image = display.images['media/thumbnail.png'];
    expect(image.sources.avif.map((item: { width: number }) => item.width)).toEqual([320, 640]);
    expect(display.images['media/p.png'].sources.webp[0].width).toBe(320);
    expect(display.images['media/l.png'].sources.avif[0].width).toBe(320);
    expect(existsSync(join(build, image.sources.avif[0].path))).toBe(true);
    expect(existsSync(join(build, '.complete'))).toBe(true);
  });

  it('fails the job when the build has no generated credits document', async () => {
    const { deps, app } = world();
    completeRun(deps);

    const response = await upload(app, archiveOf(builtFiles(undefined, { credits: false })));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ state: 'failed', reason: 'credits_invalid' });
    expect(jobState(deps)).toBe('failed');
  });

  it('refuses an archive carrying a link without touching the job, logging why', async () => {
    const { deps, app } = world();
    const log = vi.spyOn(deps, 'log');
    completeRun(deps);
    const dir = builtFiles();
    symlinkSync('/etc/hostname', join(dir, 'leak.txt'));

    const response = await upload(app, archiveOf(dir));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: { code: 'archive_unsupported_entry' } });
    expect(jobState(deps)).toBe('running');
    expect(builds(deps)).toEqual([]);
    expect(log).toHaveBeenCalledWith({
      event: 'build_upload_refused',
      jobId: ids.job,
      reason: 'archive_unsupported_entry',
    });
  });

  it('accepts uploads only from the daemon that owns a build job still awaiting its build', async () => {
    const body = archiveOf(builtFiles());
    expect((await upload(world().app, body, { authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await upload(world().app, body, { 'x-gm-sha': 'HEAD' })).status).toBe(400);
    expect((await upload(world('scope').app, body)).status).toBe(409);

    const { deps, app } = world();
    deps.db.update(schema.jobs).set({ state: 'cancelled' }).run();
    expect((await upload(app, body)).status).toBe(409);
  });
});

describe('re-uploads', () => {
  it('publishes the latest upload when a second one arrives before the merge', async () => {
    const { deps, app } = world();
    const first = builtFiles();
    const second = builtFiles();
    writeFileSync(join(second, 'index.html'), '<!doctype html><title>Second</title>\n');
    expect((await upload(app, archiveOf(first))).status).toBe(202);
    expect((await upload(app, archiveOf(second), { 'x-gm-sha': 'f'.repeat(40) })).status).toBe(202);

    completeRun(deps);
    const outcome = await publishStaged(deps, ids.job);
    expect(outcome).toMatchObject({ state: 'done' });
    const [build] = builds(deps);
    expect(build).toMatchObject({ gitSha: 'f'.repeat(40) });
    expect(readFileSync(join(build!.artifactPath, 'index.html'), 'utf8')).toContain('<title>Second</title>');
  });
});

describe('publish rollback', () => {
  it('removes the build and fails the job when the branch switch is refused', async () => {
    const { deps, app } = world();
    completeRun(deps);
    deps.sqlite.prepare("UPDATE branches SET status = 'archived' WHERE id = ?").run(ids.main);

    const response = await upload(app, archiveOf(builtFiles()));
    expect(response.status).toBe(422);
    expect(jobState(deps)).toBe('failed');
    expect(builds(deps)).toEqual([expect.objectContaining({ status: 'failed' })]);
    expect(readdirSync(join(deps.config.gamesRoot, ids.game))).toEqual([]);
    expect(latestBuildId(deps)).toBeNull();
  });
});

describe('publish under concurrent edits', () => {
  it('switches the branch even when a creator edit lands mid-switch', async () => {
    const { deps, app } = world();
    completeRun(deps);
    const source = getDesignRuntime(deps).source;
    const manifestOf = source.manifest.bind(source);
    let edited = false;
    // The switch reads the new build's manifest twice; an edit between its head read and its append makes it stale.
    let calls = 0;
    source.manifest = async (gameId, buildId) => {
      calls += 1;
      if (!edited && calls === 2) {
        edited = true;
        const branch = resolveBranch(deps.sqlite, ids.game, ids.main);
        appendTransaction(deps.sqlite, {
          gameId: ids.game,
          branchId: ids.main,
          baseRev: branch.headRev,
          leaseToken: 0,
          actor: ids.user,
          kind: 'system',
          label: 'creator edit',
          baseBuildId: branch.latestBuildId ?? ids.build,
          commands: [],
          patches: [{ op: 'add', path: ['globals', 'edited'], value: true }],
          inverse: [{ op: 'remove', path: ['globals', 'edited'] }],
        });
      }
      return manifestOf(gameId, buildId);
    };

    const response = await upload(app, archiveOf(builtFiles()));
    expect(edited).toBe(true);
    expect(response.status).toBe(201);
    expect(jobState(deps)).toBe('done');
    expect(latestBuildId(deps)).toBe(builds(deps)[0]!.id);
  });
});

describe('finishRun', () => {
  it('ends a build job the feed reports cancelled', () => {
    const { deps } = world();
    finishRun(deps, ids.job, 'cancelled');
    expect(jobState(deps)).toBe('cancelled');
  });

  it('keeps a build job open when its run completes before a build arrives', () => {
    const { deps } = world();
    finishRun(deps, ids.job, 'done');
    expect(jobState(deps)).toBe('running');
  });

  it('finishes a scope job, which ships no build, as soon as its run completes', () => {
    const { deps } = world('scope');
    finishRun(deps, ids.job, 'done');
    expect(jobState(deps)).toBe('done');
  });

  it('publishes a build staged before the run completed', async () => {
    const { deps, app } = world();
    expect((await upload(app, archiveOf(builtFiles()))).status).toBe(202);
    finishRun(deps, ids.job, 'done');
    await expect.poll(() => jobState(deps)).toBe('done');
    expect(builds(deps)).toEqual([expect.objectContaining({ jobId: ids.job, status: 'tested' })]);
    // Let the background publish release its claim before the next test reuses the job id.
    await expect.poll(() => existsSync(join(deps.config.gamesRoot, '.staging', ids.job))).toBe(false);
  });
});

describe('sweepBuilds', () => {
  const graceMs = 30 * 60_000;

  it('fails a build job whose merged run never delivered a build within the grace period', async () => {
    const { deps } = world();
    completeRun(deps);

    await sweepBuilds(deps, graceMs, new Date('2026-11-01T21:00:00.000Z'));
    // Pollers keep refreshing the projection row; the grace must still run from when the completion was seen.
    completeRun(deps, '2026-11-01T21:29:00.000Z');
    await sweepBuilds(deps, graceMs, new Date('2026-11-01T21:20:00.000Z'));
    expect(jobState(deps)).toBe('running');

    await sweepBuilds(deps, graceMs, new Date('2026-11-01T21:31:00.000Z'));
    expect(jobState(deps)).toBe('failed');
    expect(deps.lines).toContainEqual(
      expect.objectContaining({ event: 'build_publish_failed', jobId: ids.job, reason: 'build_not_received' }),
    );
  });

  it('publishes a staged build whose completion the feed handed over before routes were ready', async () => {
    const { deps, app } = world();
    expect((await upload(app, archiveOf(builtFiles()))).status).toBe(202);
    completeRun(deps);

    await sweepBuilds(deps, graceMs);
    expect(jobState(deps)).toBe('done');
    expect(builds(deps)).toEqual([expect.objectContaining({ status: 'tested' })]);
  });

  it('drops a staged build of a job that ended without a merge', async () => {
    const { deps, app } = world();
    expect((await upload(app, archiveOf(builtFiles()))).status).toBe(202);
    deps.db.update(schema.jobs).set({ state: 'cancelled' }).run();

    await sweepBuilds(deps, graceMs);
    expect(readdirSync(join(deps.config.gamesRoot, '.staging'))).toEqual([]);
  });
});

describe('untarGz', () => {
  const target = () => join(mkdtempSync(join(tmpdir(), 'ogm-untar-')), 'out');

  it.each(['../escape.txt', '/etc/escape.txt', 'a/../../escape.txt'])('refuses the path %s', async (path) => {
    await expect(untarGz(tarGz([{ path, content: 'x' }]), target())).rejects.toThrow(BadArchive);
  });

  // Rewrites the first header of a gzipped tar with `edit`, then fixes its checksum so only the edit is refused.
  function withHeader(archive: Buffer, edit: (header: Buffer) => void): Buffer {
    const tar = gunzipSync(archive);
    const header = tar.subarray(0, 512);
    edit(header);
    header.fill(32, 148, 156);
    const sum = header.reduce((total, byte) => total + byte, 0);
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'latin1');
    return gzipSync(tar);
  }

  it.each([
    ['archive_not_gzip', () => Buffer.from('not a gzip stream')],
    ['archive_bad_header', () => gzipSync(gunzipSync(tarGz([{ path: 'a.txt', content: 'x' }])).fill(66, 0, 1))],
    [
      'archive_truncated',
      () => gzipSync(gunzipSync(tarGz([{ path: 'a.txt', content: 'x'.repeat(2000) }])).subarray(0, 1024)),
    ],
    ['archive_unsupported_entry', () => withHeader(tarGz([{ path: 'dev', content: '' }]), (h) => h.write('3', 156))],
    ['archive_unsafe_path', () => withHeader(tarGz([{ path: 'a.txt', content: 'x' }]), (h) => h.write('a\\b\0', 0))],
  ])('refuses %s', async (code, archive) => {
    await expect(untarGz(archive(), target())).rejects.toThrow(code);
  });

  it('refuses an archive with too many entries', async () => {
    const archive = tarGz([1, 2, 3].map((n) => ({ path: `f${n}.txt`, content: 'x' })));
    const limits = { compressedBytes: 1 << 20, unpackedBytes: 1 << 20, entries: 2 };
    await expect(untarGz(archive, target(), limits)).rejects.toThrow('archive_too_many_entries');
  });

  it('unpacks directories and long ustar paths split into prefix and name', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ogm-untar-src-'));
    const deep = join('assets', 'a'.repeat(60), 'b'.repeat(60));
    mkdirSync(join(dir, deep), { recursive: true });
    writeFileSync(join(dir, deep, 'level.json'), '{}');
    const out = target();
    await untarGz(archiveOf(dir), out);
    expect(readFileSync(join(out, deep, 'level.json'), 'utf8')).toBe('{}');
  });

  it('refuses an archive over the size limit', async () => {
    const archive = tarGz([{ path: 'big.bin', content: 'x'.repeat(4096) }]);
    const limits = { compressedBytes: 1 << 20, unpackedBytes: 1024, entries: 10 };
    await expect(untarGz(archive, target(), limits)).rejects.toThrow('archive_too_large');
  });
});
