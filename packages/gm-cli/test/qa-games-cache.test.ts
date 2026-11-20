import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildGamesCacheReport,
  matchesConfiguredOrigin,
  selectGameImageUrls,
  type CacheRun,
} from '../src/qa-games-cache.js';
import { gm, tempDir } from './helpers.js';

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/qa-games-cache-second-load.json', import.meta.url), 'utf8'),
) as CacheRun;

describe('gm qa games-cache report', () => {
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
