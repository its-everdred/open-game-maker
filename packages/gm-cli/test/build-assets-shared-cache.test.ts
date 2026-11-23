import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { trimCache } from '../src/commands/build/assets/cache.js';
import { gm, tempDir } from './helpers.js';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function png(color: string): Promise<Buffer> {
  return sharp({ create: { width: 8, height: 8, channels: 4, background: color } })
    .png()
    .toBuffer();
}

/** A fresh checkout of the same game, the way og-merge and og-publish each check a PR out into a new workspace. */
function checkout(images: Record<string, Buffer>): string {
  const cwd = tempDir('gm-shared-cache-checkout-');
  mkdirSync(join(cwd, 'assets'), { recursive: true });
  const assets = Object.entries(images).map(([name, bytes]) => {
    writeFileSync(join(cwd, 'assets', `${name}.png`), bytes);
    return {
      id: `t3:fixture/${name}`,
      sha256: sha256(bytes),
      path: `assets/${name}.png`,
      license: 'CC0-1.0',
      rights: { uses: ['in-game'], audience: 'public', redistribution: 'free', attribution: null },
      credit: {
        pack: 'fixture',
        title: 'Fixture assets',
        licenseSource: 'Fixture CC0 declaration',
        attribution: 'none required',
        source: { label: 'test fixture' },
      },
      added: '2026-11-22',
    };
  });
  writeFileSync(
    join(cwd, 'assets.lock.json'),
    `${JSON.stringify({ version: 1, family: 'chunky-low-poly', pov: 'iso', assets }, null, 2)}\n`,
  );
  return cwd;
}

async function build(cwd: string, env: Record<string, string>, home?: string) {
  const result = await gm(['build', 'assets', '--json'], { cwd, env, ...(home ? { home } : {}) });
  expect(result.code, result.err.join('\n')).toBe(0);
  const parsed = JSON.parse(result.out.at(-1)!) as { cache: { hits: number; misses: number } };
  return { cache: parsed.cache, manifest: readFileSync(join(cwd, 'public/assets/manifest.json'), 'utf8') };
}

function entries(cacheDir: string): string[] {
  return readdirSync(cacheDir).filter((name) => /^[0-9a-f]{64}-[0-9a-f]{64}$/.test(name));
}

describe('gm build assets shared host cache', () => {
  it('lets a fresh checkout reuse what another checkout built instead of rebuilding every asset', async () => {
    const images = { hero: await png('#c45'), tree: await png('#3a5') };
    const env = { GM_ASSET_CACHE_DIR: tempDir('gm-shared-cache-') };

    const first = await build(checkout(images), env);
    const second = await build(checkout(images), env);

    expect(first.cache).toEqual({ hits: 0, misses: 2 });
    expect(second.cache).toEqual({ hits: 2, misses: 0 });
    expect(second.manifest).toBe(first.manifest);
  });

  it('rebuilds only the asset whose source changed', async () => {
    const env = { GM_ASSET_CACHE_DIR: tempDir('gm-shared-cache-') };
    const tree = await png('#3a5');

    await build(checkout({ hero: await png('#c45'), tree }), env);
    const changed = await build(checkout({ hero: await png('#45c'), tree }), env);

    expect(changed.cache).toEqual({ hits: 1, misses: 1 });
  });

  it('defaults to the host cache under XDG_CACHE_HOME, else ~/.cache, outside the checkout', async () => {
    const images = { hero: await png('#c45') };
    const xdg = tempDir('gm-xdg-cache-');
    const xdgCheckout = checkout(images);
    await build(xdgCheckout, { XDG_CACHE_HOME: xdg });
    expect(entries(join(xdg, 'ogm/assets'))).toHaveLength(1);
    expect(existsSync(join(xdgCheckout, '.gm/cache/assets'))).toBe(false);

    const home = tempDir('gm-home-cache-');
    /* XDG_CACHE_HOME set to empty counts as unset, and keeps the test helper from picking a per-repo cache. */
    await build(checkout(images), { XDG_CACHE_HOME: '' }, home);
    expect(entries(join(home, '.cache/ogm/assets'))).toHaveLength(1);
  });

  it('falls back to the repo cache when the host cache cannot be created', async () => {
    const locked = tempDir('gm-locked-cache-');
    chmodSync(locked, 0o500);
    try {
      const cwd = checkout({ hero: await png('#c45') });
      await build(cwd, { GM_ASSET_CACHE_DIR: join(locked, 'assets') });
      expect(entries(join(cwd, '.gm/cache/assets'))).toHaveLength(1);
    } finally {
      chmodSync(locked, 0o700);
    }
  });

  it('trims back to GM_ASSET_CACHE_MAX_MB after a build so the disk cannot fill', async () => {
    const cacheDir = tempDir('gm-shared-cache-');
    await build(checkout({ hero: await png('#c45') }), { GM_ASSET_CACHE_DIR: cacheDir, GM_ASSET_CACHE_MAX_MB: '0' });
    expect(entries(cacheDir)).toEqual([]);
  });

  it('removes the least recently used entries first and keeps one a build just reused', async () => {
    const cacheDir = tempDir('gm-shared-cache-');
    const env = { GM_ASSET_CACHE_DIR: cacheDir };
    const hero = await png('#c45');
    await build(checkout({ hero }), env);
    const [heroKey] = entries(cacheDir);
    await build(checkout({ tree: await png('#3a5') }), env);
    const treeKey = entries(cacheDir).find((name) => name !== heroKey)!;

    const old = new Date(Date.now() - 60_000);
    utimesSync(join(cacheDir, heroKey!), old, old);
    utimesSync(join(cacheDir, treeKey), old, old);
    const reused = await build(checkout({ hero }), env);
    expect(reused.cache.hits).toBe(1);

    /* Room for one entry only: the tree entry, untouched since, goes; the hero entry the last build hit stays. */
    const { removed } = await trimCache(cacheDir, sizeOf(cacheDir, heroKey!) + 1);
    expect(removed).toBe(1);
    expect(entries(cacheDir)).toEqual([heroKey]);
  });
});

function sizeOf(cacheDir: string, key: string): number {
  const files = readdirSync(join(cacheDir, key, 'files')).map((name) => join(cacheDir, key, 'files', name));
  return [join(cacheDir, key, 'result.json'), ...files].reduce((sum, path) => sum + statSync(path).size, 0);
}
