import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

// Each encoder pass waits for the test to settle it. A build takes two passes: its card art, then the rest.
type Pass = { finish: (value: Record<string, never>) => void; fail: (error: Error) => void };
const passes = vi.hoisted(() => [] as Pass[]);
vi.mock('../../src/builds/display-images.js', () => ({
  makeDisplayImages: () => new Promise((finish, fail) => passes.push({ finish, fail })),
}));
const pass = async (index: number) => {
  await vi.waitFor(() => expect(passes.length).toBeGreaterThan(index));
  return passes[index]!;
};

import { sweepBuilds } from '../../src/builds/publish.js';
import { gameMedia } from '../../src/games/media.js';
import operatorRoutes, { prefix } from '../../src/operator/routes.js';
import { builtFiles, ids, SHA, world } from '../builds/fixtures.js';
import { INTERNAL_TOKEN } from '../helpers.js';

it('publishes three display images within the budget while derivation is still running', async () => {
  const { app, deps } = world();
  app.route(prefix, operatorRoutes);
  const files = builtFiles();
  mkdirSync(join(files, 'media'), { recursive: true });
  for (const name of ['thumbnail.png', 'portrait.png', 'landscape.png'])
    writeFileSync(join(files, 'media', name), 'fixture');
  const manifestPath = join(files, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  writeFileSync(
    manifestPath,
    JSON.stringify({ ...manifest, loading: { portrait: 'media/portrait.png', landscape: 'media/landscape.png' } }),
  );
  const archive = execFileSync('tar', ['--format=ustar', '-czf', '-', '-C', files, '.']);
  const start = passes.length;
  const started = performance.now();
  const response = await app.request(`${prefix}/games/castle-game/builds`, {
    method: 'POST',
    headers: { 'x-ogm-internal': INTERNAL_TOKEN, 'x-gm-sha': SHA },
    body: archive,
  });
  expect(response.status).toBe(201);
  expect(performance.now() - started).toBeLessThan(10_000);
  const { buildId } = (await response.json()) as { buildId: string };
  const path = join(deps.config.gamesRoot, ids.game, buildId, '.ogm-display.json');
  const metadata = JSON.parse(await readFile(path, 'utf8')) as { images?: unknown; pending?: boolean };
  expect(metadata.images).toBeUndefined();
  expect(metadata.pending).toBe(true);
  const media = (await gameMedia(deps, [ids.game])).get(ids.game)!;
  expect(media.coverUrl).toMatch(/^https:\/\/games\.example\.test\/a\/[a-f0-9]{64}\.png$/u);
  expect(media.loadingUrls?.portrait).toMatch(/^https:\/\/games\.example\.test\/a\/[a-f0-9]{64}\.png$/u);
  expect(media.loadingImages).toBeUndefined();
  (await pass(start)).finish({});
  (await pass(start + 1)).finish({});
  await vi.waitFor(async () => expect(JSON.parse(await readFile(path, 'utf8')).images).toEqual({}));
  // Simulate a restart before derivation completed: the sweep requeues the pending build.
  const marker = join(deps.config.gamesRoot, '.display-pending', buildId);
  await vi.waitFor(async () =>
    expect(
      await access(marker).then(
        () => true,
        () => false,
      ),
    ).toBe(false),
  );
  await writeFile(path, JSON.stringify(metadata));
  await writeFile(marker, JSON.stringify({ gameId: ids.game, buildId }));
  const resumed = passes.length;
  await sweepBuilds(deps, 60_000);
  (await pass(resumed)).finish({});
  (await pass(resumed + 1)).finish({});
  await vi.waitFor(async () => expect(JSON.parse(await readFile(path, 'utf8')).images).toEqual({}));
  await vi.waitFor(async () =>
    expect(
      await access(marker).then(
        () => true,
        () => false,
      ),
    ).toBe(false),
  );
});

it('continues with other pending builds after an encoder failure', async () => {
  const { app, deps } = world();
  app.route(prefix, operatorRoutes);
  const archive = execFileSync('tar', ['--format=ustar', '-czf', '-', '-C', builtFiles(), '.']);
  const publish = () =>
    app.request(`${prefix}/games/castle-game/builds`, {
      method: 'POST',
      headers: { 'x-ogm-internal': INTERNAL_TOKEN, 'x-gm-sha': SHA },
      body: archive,
    });
  const start = passes.length;
  const first = await publish();
  expect(first.status).toBe(201);
  const failFirst = await pass(start);
  const second = await publish();
  expect(second.status).toBe(201);
  const { buildId } = (await second.json()) as { buildId: string };
  failFirst.fail(new Error('invalid image'));
  (await pass(start + 1)).finish({});
  (await pass(start + 2)).finish({});
  const marker = join(deps.config.gamesRoot, '.display-pending', buildId);
  await vi.waitFor(async () =>
    expect(
      await access(marker).then(
        () => true,
        () => false,
      ),
    ).toBe(false),
  );
});
