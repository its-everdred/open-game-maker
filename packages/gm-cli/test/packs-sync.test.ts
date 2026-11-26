import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import * as tar from 'tar';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GmContext } from '../src/command.js';
import { syncMirror } from '../src/commands/packs/sync.js';
import { cloneAtPin } from '../src/packs/git.js';
import { validateLicenseMap } from '../src/packs/license-map.js';
import type { Mirror } from '../src/packs/mirrors.js';
import { packNpm, type NpmRunner } from '../src/packs/npm.js';
import { gm, tempDir } from './helpers.js';

const execFile = promisify(execFileCallback);
const temporary: string[] = [];

function fresh(prefix: string): string {
  const path = tempDir(prefix);
  temporary.push(path);
  return path;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function localGitFixture(
  files: Record<string, string> = { 'asset.obj': 'o asset\n' },
): Promise<{ bare: string; sha: string }> {
  const root = fresh('gm-sync-git-');
  const work = join(root, 'work');
  const bare = join(root, 'mirror.git');
  await mkdir(work);
  await execFile('git', ['init'], { cwd: work });
  await execFile('git', ['config', 'user.name', 'Fixture'], { cwd: work });
  await execFile('git', ['config', 'user.email', 'fixture@example.test'], { cwd: work });
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(dirname(join(work, path)), { recursive: true });
    await writeFile(join(work, path), contents);
  }
  await execFile('git', ['add', '.'], { cwd: work });
  await execFile('git', ['commit', '-m', 'fixture'], { cwd: work });
  const { stdout } = await execFile('git', ['rev-parse', 'HEAD'], { cwd: work });
  await execFile('git', ['clone', '--bare', work, bare]);
  return { bare, sha: stdout.trim() };
}

async function npmTarball(version: string): Promise<string> {
  const fixture = fresh('gm-sync-npm-fixture-');
  await mkdir(join(fixture, 'package'));
  await writeFile(join(fixture, 'package', 'package.json'), JSON.stringify({ name: '@fontsource/test', version }));
  await writeFile(join(fixture, 'package', 'font.woff2'), 'font');
  const tgz = join(fixture, `fontsource-test-${version}.tgz`);
  await tar.create({ cwd: fixture, file: tgz, gzip: true }, ['package']);
  return tgz;
}

describe('gm packs sync', () => {
  it('lists every mirror with its pin and licence mode', async () => {
    const result = await gm(['packs', 'sync', '--list']);
    expect(result.code, result.err.join('\n')).toBe(0);
    expect(result.out).toHaveLength(4);
    expect(result.out.join('\n')).toContain('kaykit');
    expect(result.out.join('\n')).toContain('fontsource:<font>');
    expect(result.out.every((line) => /\b(?:single|per-item)\b/.test(line))).toBe(true);
  });

  it('refuses agent jobs and sandboxed runs before listing or fetching', async () => {
    const job = await gm(['packs', 'sync', '--list'], { env: { GM_JOB: 'j_1' } });
    expect(job).toMatchObject({ code: 2, out: [] });
    expect(job.err.join('\n')).toContain('operator command');
    const aiur = await gm(['packs', 'sync', 'kaykit', '--dry-run'], {
      env: { AIUR_TICKET_BRANCH: 'aiur/78' },
    });
    expect(aiur.code).toBe(2);
    expect(aiur.err.join('\n')).toContain('operator command');
    const sandbox = await gm(['packs', 'sync', '--list'], { env: { OGM_SANDBOX: '1' } });
    expect(sandbox).toMatchObject({ code: 2, out: [] });
    expect(sandbox.err.join('\n')).toContain('operator command');

    const game = fresh('gm-sync-game-');
    const nested = join(game, 'nested');
    await mkdir(join(game, '.gm'), { recursive: true });
    await mkdir(nested);
    await writeFile(join(game, '.gm', 'game.json'), '{}');
    const gameRun = await gm(['packs', 'sync', '--list'], { cwd: nested });
    expect(gameRun).toMatchObject({ code: 2, out: [] });
    expect(gameRun.err.join('\n')).toContain('operator command');
  });

  it('lists valid ids for an unknown mirror and refuses repository destinations', async () => {
    const unknown = await gm(['packs', 'sync', 'missing', '--dry-run']);
    expect(unknown.code).toBe(2);
    expect(unknown.err.join('\n')).toContain('kaykit, lpc, game-icons, fontsource:<font>');

    const repository = fresh('gm-sync-repository-');
    await mkdir(join(repository, '.git'));
    const destination = join(repository, 'downloads', 'mirror');
    const unsafe = await gm(['packs', 'sync', 'kaykit', '--dry-run', '--dest', destination]);
    expect(unsafe).toMatchObject({ code: 2, out: [] });
    await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses moving refs as Git mirror pin overrides', async () => {
    const result = await gm(['packs', 'sync', 'kaykit', '--pin', 'main', '--dry-run']);
    expect(result).toMatchObject({ code: 2, out: [] });
    expect(result.err.join('\n')).toContain('40-character commit SHA');
  });

  it('prints a dry-run plan without creating the destination', async () => {
    const dest = `/srv/ogm-test/Downloads/ogm-mirrors-test-${process.pid}/not-created`;
    const events = join(fresh('gm-sync-events-'), 'events.jsonl');
    const result = await gm(['packs', 'sync', 'kaykit', '--dry-run', '--dest', dest], {
      env: { GM_EVENTS_FILE: events },
    });
    expect(result.code, result.err.join('\n')).toBe(0);
    expect(result.out.join('\n')).toMatch(/git clone.*gm packs import.*--tier 2/s);
    await expect(stat(dest)).rejects.toMatchObject({ code: 'ENOENT' });
    const event = JSON.parse((await readFile(events, 'utf8')).trim());
    expect(event).toMatchObject({ event: 'packs.sync', payload: { mirror: 'kaykit', dry_run: true } });
  });

  it('clones a local mirror at its exact pin and names both SHAs for a bad pin', async () => {
    const fixture = await localGitFixture();
    const destination = join(fresh('gm-sync-clone-'), 'checkout');
    await expect(cloneAtPin(fixture.bare, fixture.sha, destination)).resolves.toEqual({ sha: fixture.sha });
    await expect(readFile(join(destination, 'asset.obj'), 'utf8')).resolves.toBe('o asset\n');

    const wrong = join(fresh('gm-sync-wrong-'), 'checkout');
    const expected = 'f'.repeat(40);
    await expect(cloneAtPin(fixture.bare, expected, wrong)).rejects.toThrow(
      new RegExp(`expected ${expected}.*actual ${fixture.sha}`),
    );
  });

  it('refuses a real sync before downloading when the asset library is missing', async () => {
    const destination = join(fresh('gm-sync-no-library-'), 'download');
    const ctx = {
      cwd: fresh('gm-sync-no-library-cwd-'),
      assetsRoot: null,
      skillsDir: null,
      config: { verifySoftwareGl: false, verifyQueue: false },
      json: true,
      limit: 10,
      fields: null,
      out: vi.fn(),
      err: vi.fn(),
      emit: vi.fn(),
      blobRoot: null,
      blocklistFile: null,
    } satisfies GmContext;
    const mirror: Mirror = {
      id: 'fixture',
      kind: 'git',
      source: 'https://example.test/never-fetched.git',
      pin: 'a'.repeat(40),
      title: 'Fixture mirror',
      license: { mode: 'single', spdx: 'CC0-1.0', ref: 'LICENSE.txt', attribution: null },
    };

    await expect(
      syncMirror(ctx, mirror, {
        pin: mirror.pin,
        destination,
        includeSa: false,
        confirmedBy: 'test-operator',
      }),
    ).rejects.toThrow(/asset library/i);
    await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('hands a verified local mirror to tier-2 import with provenance and attribution', async () => {
    const fixture = await localGitFixture();
    const assetsRoot = fresh('gm-sync-assets-');
    const destination = join(fresh('gm-sync-download-'), 'fixture');
    const emitted = vi.fn();
    const ctx = {
      cwd: fresh('gm-sync-cwd-'),
      assetsRoot,
      skillsDir: null,
      config: { verifySoftwareGl: false, verifyQueue: false },
      json: true,
      limit: 10,
      fields: null,
      out: vi.fn(),
      err: vi.fn(),
      emit: emitted,
      blobRoot: null,
      blocklistFile: null,
    } satisfies GmContext;
    const mirror: Mirror = {
      id: 'fixture',
      kind: 'git',
      source: fixture.bare,
      pin: fixture.sha,
      title: 'Fixture mirror',
      license: { mode: 'single', spdx: 'CC0-1.0', ref: 'LICENSE.txt', attribution: 'Fixture Author' },
    };

    const result = await syncMirror(ctx, mirror, {
      pin: fixture.sha,
      destination,
      includeSa: false,
      confirmedBy: 'test-operator',
    });

    expect(result).toMatchObject({ collection: `t2:fixture@${fixture.sha}`, status: 'imported', cards: 1 });
    const pack = JSON.parse(await readFile(join(assetsRoot, 'packs', 'fixture', 'pack.json'), 'utf8'));
    expect(pack).toMatchObject({
      title: 'Fixture mirror',
      license: 'CC0-1.0',
      source: { type: 'git', url: fixture.bare, pin: fixture.sha },
    });
    const card = JSON.parse(await readFile(join(assetsRoot, 'packs', 'fixture', 'cards', 'asset.card.json'), 'utf8'));
    expect(card).toMatchObject({
      id: `t2:fixture/asset@${fixture.sha}`,
      rights: { attribution: 'Fixture Author', redistribution: 'free' },
    });
    expect(emitted).toHaveBeenCalledWith('packs.sync', expect.objectContaining({ mirror: 'fixture' }));
    await expect(stat(join(destination, 'checkout', '.git'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('uses the restrictive kept LPC share-alike licence as the collection ceiling', async () => {
    const fixture = await localGitFixture({
      'CREDITS.csv':
        'filename,notes,authors,licenses,urls\n"sa.png","","SA Author","CC-BY-SA 3.0","https://example.test/sa"\n',
      'spritesheets/sa.png': 'not-a-real-png',
    });
    const assetsRoot = fresh('gm-sync-lpc-assets-');
    const destination = join(fresh('gm-sync-lpc-download-'), 'fixture');
    const ctx = {
      cwd: fresh('gm-sync-lpc-cwd-'),
      assetsRoot,
      skillsDir: null,
      config: { verifySoftwareGl: false, verifyQueue: false },
      json: true,
      limit: 10,
      fields: null,
      out: vi.fn(),
      err: vi.fn(),
      emit: vi.fn(),
      blobRoot: null,
      blocklistFile: null,
    } satisfies GmContext;
    const mirror: Mirror = {
      id: 'lpc-fixture',
      kind: 'git',
      source: fixture.bare,
      pin: fixture.sha,
      title: 'LPC fixture',
      license: { mode: 'per-item', mapper: 'lpc-credits-csv', ref: 'CREDITS.csv' },
      subpaths: ['spritesheets'],
    };

    const result = await syncMirror(ctx, mirror, {
      pin: fixture.sha,
      destination,
      includeSa: true,
      confirmedBy: 'test-operator',
    });

    expect(result).toMatchObject({ collection: `t2:lpc-fixture@${fixture.sha}`, license: 'CC-BY-SA-3.0' });
    const card = JSON.parse(await readFile(join(assetsRoot, 'packs', 'lpc-fixture', 'cards', 'sa.card.json'), 'utf8'));
    expect(card).toMatchObject({
      license: 'CC-BY-SA-3.0',
      rights: { attribution: 'SA Author', redistribution: 'free' },
    });
  });

  it('packs npm without scripts, safely extracts it, and verifies the package version', async () => {
    const tgz = await npmTarball('1.2.3');
    const runner: NpmRunner = vi.fn(async (_file, args, options) => {
      expect(args.slice(0, 5)).toEqual([
        'pack',
        '@fontsource/test@1.2.3',
        '--pack-destination',
        expect.any(String),
        '--ignore-scripts',
      ]);
      expect(args).toContain('--registry=https://registry.npmjs.org/');
      expect(options).toMatchObject({ timeout: 30 * 60_000, killSignal: 'SIGKILL' });
      expect(options.env).toMatchObject({
        LANG: 'C',
        npm_config_ignore_scripts: 'true',
        npm_config_registry: 'https://registry.npmjs.org/',
      });
      expect(Object.keys(options.env).every((key) => !/token|key|secret/i.test(key))).toBe(true);
      const destination = args[3]!;
      await writeFile(join(destination, 'fontsource-test-1.2.3.tgz'), await readFile(tgz));
      return { stdout: 'fontsource-test-1.2.3.tgz\n', stderr: '' };
    });
    const destination = fresh('gm-sync-npm-out-');

    const result = await packNpm('@fontsource/test', '1.2.3', destination, runner);
    expect(result.extracted).toBe(join(destination, 'extracted'));
    await expect(readFile(join(result.extracted, 'font.woff2'), 'utf8')).resolves.toBe('font');
    expect(runner).toHaveBeenCalledOnce();
  });

  it('refuses an npm tarball whose manifest version differs from the reviewed pin', async () => {
    const tgz = await npmTarball('1.2.4');
    const runner: NpmRunner = vi.fn(async (_file, args) => {
      const destination = args[3]!;
      await writeFile(join(destination, 'fontsource-test-1.2.4.tgz'), await readFile(tgz));
      return { stdout: 'fontsource-test-1.2.4.tgz\n', stderr: '' };
    });

    await expect(packNpm('@fontsource/test', '1.2.3', fresh('gm-sync-npm-mismatch-'), runner)).rejects.toThrow(
      /expected 1\.2\.3, actual 1\.2\.4/,
    );
  });

  it('requires attribution for attribution-bearing tier-2 licenses', () => {
    expect(() =>
      validateLicenseMap({
        'asset.svg': { license: 'CC-BY-3.0', attribution: null },
      }),
    ).toThrow(/requires attribution/);
    expect(() =>
      validateLicenseMap({
        'asset.svg': { license: 'GPL-3.0-only', attribution: 'Author' },
      }),
    ).toThrow(/GPL license .* must be dropped/);
  });

  it('imports tier-2 cards with per-item rights and omits dropped or unmapped assets', async () => {
    const assets = fresh('gm-sync-assets-');
    const input = fresh('gm-sync-input-');
    await writeFile(join(input, 'kept.obj'), 'o kept\n');
    await writeFile(join(input, 'dropped.obj'), 'o dropped\n');
    await writeFile(join(input, 'unmapped.obj'), 'o unmapped\n');
    await writeFile(join(input, 'scene.unity'), 'scene');
    await writeFile(join(input, 'prop.prefab'), 'prefab');
    const map = join(fresh('gm-sync-map-'), 'licenses.json');
    await writeFile(
      map,
      JSON.stringify({
        'kept.obj': { license: 'CC0-1.0', attribution: 'Fixture Author' },
        'dropped.obj': { license: 'GPL-3.0-only', attribution: 'Other', dropped: 'GPL excluded' },
        'scene.unity': { license: 'CC0-1.0', attribution: 'Fixture Author' },
        'prop.prefab': { license: 'CC0-1.0', attribution: 'Fixture Author' },
      }),
    );

    const result = await gm(
      [
        'packs',
        'import',
        input,
        '--id',
        'mirror-test',
        '--version',
        'pin1',
        '--tier',
        '2',
        '--license',
        'CC-BY-3.0',
        '--license-map',
        map,
        '--confirmed-by',
        'test-operator',
        '--json',
      ],
      { env: { OGM_ASSETS_ROOT: assets } },
    );

    expect(result.code, result.err.join('\n')).toBe(0);
    expect(JSON.parse(result.out[0]!)).toMatchObject({
      collection: 't2:mirror-test@pin1',
      status: 'imported',
      license: 'CC-BY-3.0',
      confirmed_by: 'test-operator',
      cards: 1,
    });
    const pack = join(assets, 'packs', 'mirror-test');
    const collection = JSON.parse(await readFile(join(pack, 'collection.card.json'), 'utf8'));
    expect(collection).toMatchObject({
      id: 't2:mirror-test@pin1',
      license: 'CC-BY-3.0',
      collection_info: { origin: 'mirror' },
      rights: { redistribution: 'free' },
      scenes: [],
      prefabs: [],
    });
    const card = JSON.parse(await readFile(join(pack, 'cards', 'kept.card.json'), 'utf8'));
    expect(card).toMatchObject({
      id: 't2:mirror-test/kept@pin1',
      collection: 't2:mirror-test@pin1',
      license: 'CC0-1.0',
      rights: { attribution: 'Fixture Author', redistribution: 'free' },
    });
    await expect(stat(join(pack, 'pin1', 'extracted', 'dropped.obj'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(join(pack, 'pin1', 'extracted', 'unmapped.obj'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(join(pack, 'pin1', 'extracted', 'scene.unity'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(join(pack, 'pin1', 'extracted', 'prop.prefab'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('requires a named human for real tier-2 import', async () => {
    const input = fresh('gm-sync-input-');
    await writeFile(join(input, 'asset.obj'), 'o asset\n');
    const result = await gm(
      ['packs', 'import', input, '--id', 'mirror-test', '--version', 'pin1', '--tier', '2', '--license', 'CC0-1.0'],
      { env: { OGM_ASSETS_ROOT: fresh('gm-sync-assets-') } },
    );
    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toContain('--confirmed-by');
  });

  it('refuses GPL as a tier-2 collection license', async () => {
    const input = fresh('gm-sync-input-');
    await writeFile(join(input, 'asset.obj'), 'o asset\n');
    const result = await gm(
      [
        'packs',
        'import',
        input,
        '--id',
        'mirror-test',
        '--version',
        'pin1',
        '--tier',
        '2',
        '--license',
        'GPL-3.0-only',
        '--confirmed-by',
        'test-operator',
      ],
      { env: { OGM_ASSETS_ROOT: fresh('gm-sync-assets-') } },
    );
    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toContain('unsupported kept tier-2 license');
  });
});
