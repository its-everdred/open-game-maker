import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildGamesCacheReport,
  buildAfterPublishReport,
  matchesConfiguredOrigin,
  selectGameImageUrls,
  type CacheRun,
} from '../src/qa-games-cache.js';
import { gm, tempDir } from './helpers.js';

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/qa-games-cache-second-load.json', import.meta.url), 'utf8'),
) as CacheRun;

describe('gm qa games-cache report', () => {
  it('compares restricted builds by content and omits grant URLs', () => {
    const report = buildAfterPublishReport({
      game: 'blobs',
      buildId: 'new',
      previousBuildId: 'old',
      previous: [{ sourcePath: 'sprites/a.png', url: '/d/g/old/secret/a.png', identity: 'same', bytes: 10 }],
      current: [{ sourcePath: 'sprites/a.png', url: '/d/g/new/secret/a.png', identity: 'same', bytes: 10 }],
      samples: [{ url: '/d/g/new/secret/a.png', transferSize: 10 }],
      expectCache: false,
    });
    expect(report.ok).toBe(true);
    expect(report.unexpectedTransfers).toEqual([]);
    expect(JSON.stringify(report)).not.toContain('secret');
  });

  it('accepts no-store images and redacts scoped access URLs', () => {
    const scoped = 'https://games.example.test/d/g/build/secret/logo.png';
    const sample = {
      url: scoped,
      status: 200,
      transferSize: 100,
      duration: 1,
      cacheControl: 'no-store',
      cache: 'network' as const,
    };
    const report = buildGamesCacheReport({ ...fixture, logoUrl: scoped, thumbnailUrl: scoped, resources: [sample] });
    expect(report.ok).toBe(true);
    expect(JSON.stringify(report)).not.toContain('secret');
  });
  it('counts only bytes for changed files after a no-op publish', () => {
    const previous = [
      { sourcePath: 'index.html', url: '/a/index-old.html', bytes: 120 },
      { sourcePath: 'manifest.json', url: '/a/manifest-old.json', bytes: 80 },
      { sourcePath: 'sprites/hero.png', url: '/a/hero.hash.png', bytes: 4096 },
    ];
    const current = [
      { sourcePath: 'index.html', url: '/a/index-new.html', bytes: 120 },
      { sourcePath: 'manifest.json', url: '/a/manifest-new.json', bytes: 80 },
      { sourcePath: 'sprites/hero.png', url: '/a/hero.hash.png', bytes: 4096 },
    ];
    const report = buildAfterPublishReport({
      game: 'blobs',
      buildId: 'build-2',
      previousBuildId: 'build-1',
      previous,
      current,
      samples: [
        { url: '/a/index-new.html', transferSize: 120 },
        { url: '/a/manifest-new.json', transferSize: 80 },
        { url: '/a/hero.hash.png', transferSize: 0 },
      ],
    });
    expect(report).toMatchObject({
      totalBytesTransferred: 200,
      ok: true,
      changedFiles: [{ path: 'index.html' }, { path: 'manifest.json' }],
    });
  });

  it('fails a no-op check when a sprite URL changed and detects transfers for unchanged files', () => {
    const report = buildAfterPublishReport({
      game: 'blobs',
      buildId: 'build-2',
      previousBuildId: 'build-1',
      previous: [
        { sourcePath: 'index.html', url: '/a/index.html', bytes: 120 },
        { sourcePath: 'sprites/hero.png', url: '/a/hero-old.png', bytes: 4096 },
        { sourcePath: 'sprites/tree.png', url: '/a/tree.png', bytes: 2048 },
      ],
      current: [
        { sourcePath: 'index.html', url: '/a/index.html', bytes: 120 },
        { sourcePath: 'sprites/hero.png', url: '/a/hero-new.png', bytes: 4200 },
        { sourcePath: 'sprites/tree.png', url: '/a/tree.png', bytes: 2048 },
      ],
      samples: [
        { url: '/a/index.html', transferSize: 0 },
        { url: '/a/hero-new.png', transferSize: 4200 },
        { url: '/a/tree.png', transferSize: 0 },
      ],
    });
    expect(report.totalBytesTransferred).toBe(4200);
    expect(report.changedFiles).toMatchObject([{ path: 'sprites/hero.png', bytes: 4200 }]);
    expect(report.unexpectedChanges).toMatchObject([{ path: 'sprites/hero.png', bytes: 4200 }]);
    expect(report.unexpectedTransfers).toEqual([]);
    expect(report.ok).toBe(false);
  });

  it('fails when an unchanged content URL transfers again', () => {
    const report = buildAfterPublishReport({
      game: 'blobs',
      buildId: 'build-2',
      previousBuildId: 'build-1',
      previous: [{ sourcePath: 'sprites/tree.png', url: '/a/tree.png', bytes: 2048 }],
      current: [{ sourcePath: 'sprites/tree.png', url: '/a/tree.png', bytes: 2048 }],
      samples: [{ url: '/a/tree.png', transferSize: 2048 }],
    });
    expect(report.unexpectedTransfers).toMatchObject([{ path: 'sprites/tree.png', bytes: 2048 }]);
    expect(report.ok).toBe(false);
  });

  it('fails when a no-op publish removes a game file', () => {
    const report = buildAfterPublishReport({
      game: 'blobs',
      buildId: 'build-2',
      previousBuildId: 'build-1',
      previous: [{ sourcePath: 'sprites/hero.png', url: '/a/hero.png', bytes: 4096 }],
      current: [],
      samples: [],
    });
    expect(report.changedFiles).toMatchObject([{ path: 'sprites/hero.png', from: '/a/hero.png', to: null }]);
    expect(report.unexpectedChanges).toEqual(report.changedFiles);
    expect(report.ok).toBe(false);
  });

  it('reports the second-load image and API evidence and passes only when both images are cached', () => {
    const report = buildGamesCacheReport(fixture);
    expect(report).toMatchObject({
      game: 'blobs',
      viewport: { width: 390, height: 844 },
      logo: {
        status: 200,
        transferSize: 0,
        cacheControl: 'public, max-age=31536000, immutable',
        cache: 'cache (memory/disk unknown)',
      },
      thumbnail: { status: 200, transferSize: 0, cache: 'cache (memory/disk unknown)' },
      gamesListApi: { status: 200, duration: 842.4 },
      ok: true,
    });
  });

  it('fails when an image transferred bytes on the second load', () => {
    const uncached: CacheRun = {
      ...fixture,
      resources: fixture.resources.map((item) =>
        item.url.endsWith('thumbnail.webp') ? { ...item, transferSize: 4_096 } : item,
      ),
    };
    expect(buildGamesCacheReport(uncached).ok).toBe(false);
  });

  it('does not pass when zero transfer bytes have no cache evidence', () => {
    const unknown: CacheRun = {
      ...fixture,
      resources: fixture.resources.map((item) => ({ ...item, cache: 'unknown' })),
    };
    expect(buildGamesCacheReport(unknown).ok).toBe(false);
  });

  it('allows only the configured origin to receive the QA session', () => {
    expect(matchesConfiguredOrigin('https://app.example.test', 'https://app.example.test/')).toBe(true);
    expect(matchesConfiguredOrigin('https://attacker.example.test', 'https://app.example.test')).toBe(false);
    expect(matchesConfiguredOrigin('https://app.example.test', undefined)).toBe(false);
  });

  it('maps the games tile logo and cover using their stable DOM classes', () => {
    expect(
      selectGameImageUrls([
        { className: 'game-cover-image', src: '/hashed/cover.png', currentSrc: '/hashed/cover.webp' },
        { className: 'game-logo', src: '/hashed/logo.png', currentSrc: '/hashed/logo.avif' },
      ]),
    ).toEqual({ logo: '/hashed/logo.avif', thumbnail: '/hashed/cover.webp' });
  });

  it('requires the host QA session before launching a browser', async () => {
    const home = tempDir();
    const env = join(home, '.config/ogm/env');
    mkdirSync(env, { recursive: true });
    writeFileSync(join(env, 'api.env'), 'OGM_APP_ORIGIN=https://app.example.test\n');
    const { code, err } = await gm(['qa', 'games-cache', '--origin', 'https://app.example.test'], {
      home,
      env: {},
    });
    expect(code).toBe(1);
    expect(err.join('\n')).toContain('missing the QA session');
  });
});
