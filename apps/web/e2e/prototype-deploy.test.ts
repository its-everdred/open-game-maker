import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { stagePrototype } from '../tools/stage-prototype.mjs';

const scratch: string[] = [];

async function fixture(): Promise<{ destination: string; prototype: string; shell: string }> {
  const root = await mkdtemp(join(tmpdir(), 'ogm-prototype-deploy-'));
  scratch.push(root);
  const prototype = join(root, 'studio-v0');
  const shell = join(root, 'ui-v0');
  const destination = join(root, 'deploy', 'proto');

  await Promise.all([
    mkdir(join(prototype, 'art', 'packs', 'synty'), { recursive: true }),
    mkdir(join(prototype, 'art', 'music'), { recursive: true }),
    mkdir(join(prototype, 'demo'), { recursive: true }),
    mkdir(join(prototype, 'town'), { recursive: true }),
    mkdir(join(shell, 'icons'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(prototype, 'index.html'), '<title>Open Game Maker 2000</title><main>prototype</main>'),
    writeFile(join(prototype, 'app.js'), "navigator.serviceWorker.register('sw.js').catch(() => {});\n"),
    writeFile(join(prototype, 'data.js'), 'window.prototypeData = true;\n'),
    writeFile(join(prototype, 'scenes.js'), 'im.src = src;\n'),
    writeFile(
      join(prototype, 'sw.js'),
      "const BUILD = '__BUILD__', CACHE = 'ogm-' + BUILD, ASSETS = 'ogm-assets';\nself.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== ASSETS).map(k => caches.delete(k))))));\n",
    ),
    writeFile(join(prototype, 'art', 'packs', 'kenney-safe.webp'), 'safe'),
    writeFile(join(prototype, 'art', 'packs', 'synty-private.webp'), 'private'),
    writeFile(join(prototype, 'art', 'packs', 'synty', 'private.webp'), 'private'),
    writeFile(join(prototype, 'art', 'packs', 'smallscaleint-private.webp'), 'private'),
    writeFile(join(prototype, 'art', 'music', 'sidetrax-theme.mp3'), 'private'),
    writeFile(join(prototype, 'art', 'music', 'camelot.mp3'), 'private'),
    writeFile(join(prototype, 'art', 'music', 'underground.mp3'), 'private'),
    writeFile(join(prototype, 'demo', 'index.html'), 'demo'),
    writeFile(join(prototype, 'town', 'index.html'), 'town'),
    writeFile(join(shell, 'favicon.ico'), 'icon'),
    writeFile(join(shell, 'site.webmanifest'), '{}'),
    writeFile(join(shell, 'icons', 'icon-192.png'), 'icon'),
  ]);

  return { destination, prototype, shell };
}

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('prototype deploy staging', () => {
  it('copies the archived site beneath proto and wraps its HTML fragment', async () => {
    const { destination, prototype, shell } = await fixture();

    await stagePrototype(prototype, shell, destination);

    const index = await readFile(join(destination, 'index.html'), 'utf8');
    expect(index).toMatch(/^<!doctype html>\n<html lang="en">/);
    expect(index).toContain('<main>prototype</main>');
    await expect(readFile(join(destination, 'demo', 'index.html'), 'utf8')).resolves.toBe('demo');
    await expect(readFile(join(destination, 'town', 'index.html'), 'utf8')).resolves.toBe('town');
    await expect(readFile(join(destination, 'icons', 'icon-192.png'), 'utf8')).resolves.toBe('icon');
    await expect(readFile(join(destination, 'scenes.js'), 'utf8')).resolves.toContain(
      'new URL(src, import.meta.url).href',
    );
  });

  it('keeps every asset for an instance and isolates the prototype service worker', async () => {
    const { destination, prototype, shell } = await fixture();

    await stagePrototype(prototype, shell, destination);

    expect(await readdir(join(destination, 'art', 'packs'))).toEqual([
      'kenney-safe.webp',
      'smallscaleint-private.webp',
      'synty',
      'synty-private.webp',
    ]);
    expect(await readdir(join(destination, 'art', 'music'))).toEqual([
      'camelot.mp3',
      'sidetrax-theme.mp3',
      'underground.mp3',
    ]);
    expect(await readFile(join(destination, 'app.js'), 'utf8')).toContain(
      "navigator.serviceWorker.register('sw.js', { scope: './' })",
    );
    const worker = await readFile(join(destination, 'sw.js'), 'utf8');
    expect(worker).toContain("CACHE = 'ogm-proto-' + BUILD");
    expect(worker).toContain("ASSETS = 'ogm-proto-assets'");
    expect(worker).toContain("ks.filter(k => k.startsWith('ogm-proto-') && k !== CACHE && k !== ASSETS)");
  });

  it('removes licensed paths only for an explicit public-only payload', async () => {
    const { destination, prototype, shell } = await fixture();

    await stagePrototype(prototype, shell, destination, { publicOnly: true });

    expect(await readdir(join(destination, 'art', 'packs'))).toEqual(['kenney-safe.webp']);
    expect(await readdir(join(destination, 'art', 'music'))).toEqual([]);
  });

  it('rejects symbolic links from the staged payload', async () => {
    const { destination, prototype, shell } = await fixture();
    await symlink(
      join(prototype, 'art', 'packs', 'synty-private.webp'),
      join(prototype, 'art', 'packs', 'public-looking.webp'),
    );

    await expect(stagePrototype(prototype, shell, destination)).rejects.toThrow(
      'prototype deploy payload contains a symbolic link: art/packs/public-looking.webp',
    );
  });
});
