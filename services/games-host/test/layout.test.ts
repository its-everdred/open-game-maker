import { mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { linkMock } = vi.hoisted(() => ({ linkMock: vi.fn() }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  linkMock.mockImplementation(actual.link);
  return { ...actual, link: linkMock };
});

import {
  BadBlobName,
  BadId,
  blobPath,
  buildDir,
  gcBlobs,
  isComplete,
  markComplete,
  putBlob,
  resolveFile,
} from '../src/layout.js';

describe('games-host layout', () => {
  let root: string;
  let build: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ogm-games-layout-'));
    build = join(root, 'demo', 'b1');
    await mkdir(join(build, 'assets'), { recursive: true });
    await writeFile(join(build, 'index.html'), '<h1>demo</h1>');
    await writeFile(join(build, 'assets', 'x.webp'), 'webp');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('builds paths only from valid ids', () => {
    expect(buildDir(root, 'demo', 'b1')).toBe(join(root, 'demo', 'b1'));
    expect(buildDir(root, 'g_01ARZ3NDEKTSV4RRFFQ69G5FAV', 'b_01BX5ZZKBKACTAV9WEVGEMMVRZ')).toBe(
      join(root, 'g_01ARZ3NDEKTSV4RRFFQ69G5FAV', 'b_01BX5ZZKBKACTAV9WEVGEMMVRZ'),
    );
    expect(buildDir(root, 'game2_01ARZ3NDEKTSV4RRFFQ69G5FAV', '01BX5ZZKBKACTAV9WEVGEMMVRZ')).toBe(
      join(root, 'game2_01ARZ3NDEKTSV4RRFFQ69G5FAV', '01BX5ZZKBKACTAV9WEVGEMMVRZ'),
    );

    /* Uppercase is allowed only in the exact ULID shape: no ULID past 7ZZZ…, no uppercase prefix. */
    for (const id of [
      'Demo',
      '..',
      `a${'b'.repeat(64)}`,
      'b_81ARZ3NDEKTSV4RRFFQ69G5FAV',
      'B_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    ]) {
      expect(() => buildDir(root, id, 'b1')).toThrow(BadId);
      expect(() => buildDir(root, 'demo', id)).toThrow(BadId);
    }
  });

  it('resolves files within the build and defaults to index.html', async () => {
    await expect(resolveFile(build, '')).resolves.toBe(resolve(build, 'index.html'));
    await expect(resolveFile(build, '/')).resolves.toBe(resolve(build, 'index.html'));
    await expect(resolveFile(build, 'assets/x.webp')).resolves.toBe(resolve(build, 'assets/x.webp'));
  });

  it.each([
    '../index.html',
    '%2e%2e/x',
    '%E0%A4%A',
    'assets/../../x',
    '/etc/passwd',
    'assets\\x.webp',
    'assets//x.webp',
  ])('rejects unsafe path %s', async (unsafePath) => {
    await expect(resolveFile(build, unsafePath)).resolves.toBeNull();
  });

  it('rejects symlinks that escape the build directory', async () => {
    const outside = join(root, 'outside.txt');
    await writeFile(outside, 'outside');
    await symlink(outside, join(build, 'assets', 'escape.txt'));

    await expect(resolveFile(build, 'assets/escape.txt')).resolves.toBeNull();
  });

  it('marks a build complete only after writing a durable marker', async () => {
    await expect(isComplete(build)).resolves.toBe(false);

    await markComplete(build);

    await expect(isComplete(build)).resolves.toBe(true);
    const marker = await readFile(join(build, '.complete'), 'utf8');
    expect(Number.isNaN(Date.parse(marker.trim()))).toBe(false);
  });

  it('builds shared blob paths only from full lowercase content hashes', () => {
    const file = `${'a'.repeat(64)}.webp`;

    expect(blobPath(root, file)).toBe(join(root, '_a', file));
    expect(blobPath(root, `${'c'.repeat(64)}.js`)).toBe(join(root, '_a', `${'c'.repeat(64)}.js`));
    expect(blobPath(root, `${'d'.repeat(64)}.exe`)).toBe(join(root, '_a', `${'d'.repeat(64)}.exe`));
    for (const invalid of [`${'a'.repeat(63)}.webp`, `${'A'.repeat(64)}.webp`, `../${file}`, `_a/${file}`]) {
      expect(() => blobPath(root, invalid)).toThrow(BadBlobName);
    }
  });

  it('puts a blob durably and treats a second put as a no-op', async () => {
    const file = `${'b'.repeat(64)}.webp`;
    const staging = join(root, 'staging');
    const source = join(staging, file);
    await mkdir(staging);
    await writeFile(source, 'shared-image');

    const destination = await putBlob(root, source);
    expect(destination).toBe(join(root, '_a', file));
    await expect(readFile(destination, 'utf8')).resolves.toBe('shared-image');

    await unlink(source);
    await expect(putBlob(root, source)).resolves.toBe(destination);
    await expect(readFile(destination, 'utf8')).resolves.toBe('shared-image');
  });

  it('copies a blob when a cross-device hard link is unavailable', async () => {
    const file = `${'c'.repeat(64)}.webp`;
    const staging = join(root, 'staging');
    const source = join(staging, file);
    await mkdir(staging);
    await writeFile(source, 'cross-device-image');
    linkMock.mockRejectedValueOnce(Object.assign(new Error('cross-device link'), { code: 'EXDEV' }));

    const destination = await putBlob(root, source);

    await expect(readFile(destination, 'utf8')).resolves.toBe('cross-device-image');
  });

  it('collects only unreferenced blobs and fails closed on an invalid live plan', async () => {
    const kept = `${'d'.repeat(64)}.png`;
    const removed = `${'e'.repeat(64)}.png`;
    await mkdir(join(root, '_a'));
    await writeFile(blobPath(root, kept), 'kept');
    await writeFile(blobPath(root, removed), 'removed');
    const phases = {
      boot: { bytes: 0, files: 0 },
      ready: { bytes: 4, files: 1 },
      stream: { bytes: 0, files: 0 },
    };
    await writeFile(
      join(build, 'assets', 'cache-plan.json'),
      JSON.stringify({
        version: 1,
        gameId: 'demo',
        buildId: 'b1',
        built: '2026-11-02T20:00:00.000Z',
        sdkVersion: '1.0.0',
        tiers: ['desktop'],
        entries: [
          {
            sha256: 'd'.repeat(64),
            url: `/a/${kept}`,
            bytes: 4,
            kind: 'sprite',
            phase: 'ready',
            tiers: ['*'],
          },
        ],
        totals: {
          desktop: phases,
          mobile: {
            boot: { bytes: 0, files: 0 },
            ready: { bytes: 0, files: 0 },
            stream: { bytes: 0, files: 0 },
          },
          low: {
            boot: { bytes: 0, files: 0 },
            ready: { bytes: 0, files: 0 },
            stream: { bytes: 0, files: 0 },
          },
        },
      }),
    );

    await gcBlobs(root, [build]);
    await expect(readFile(blobPath(root, kept), 'utf8')).resolves.toBe('kept');
    await expect(readFile(blobPath(root, removed), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    await writeFile(blobPath(root, removed), 'removed');
    await writeFile(join(build, 'assets', 'cache-plan.json'), '{broken');
    await expect(gcBlobs(root, [build])).rejects.toBeInstanceOf(SyntaxError);
    await expect(readFile(blobPath(root, kept), 'utf8')).resolves.toBe('kept');
    await expect(readFile(blobPath(root, removed), 'utf8')).resolves.toBe('removed');
  });
});
