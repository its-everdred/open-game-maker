import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { schema } from '@ogm/db';
import { gcBlobs } from '@ogm/games-host/layout';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import previewRoutes from '../../src/previews/routes.js';
import { previewBuildDirectories } from '../../src/previews/store.js';
import { createApp } from '../../src/app/app.js';
import { buildRoutes } from '../../src/builds/routes.js';
import { asUser } from '../helpers.js';
import { builtFiles, ids, REPO, SECRET, SHA, world } from '../builds/fixtures.js';

const archive = () => execFileSync('tar', ['--format=ustar', '-czf', '-', '-C', builtFiles(), '.']);

function setup() {
  const { deps } = world();
  const app = createApp(deps);
  app.route(
    '/internal',
    buildRoutes({
      daemonForSecret: async () => null,
      gameForSecret: async (secret) => (secret === SECRET ? { repo: REPO, slug: 'castle-game' } : null),
    }),
  );
  const [owner, repo] = REPO.split('/');
  deps.db.update(schema.games).set({ githubOwner: owner, githubRepo: repo }).where(eq(schema.games.id, ids.game)).run();
  const message = vi.fn(async () => ({}));
  deps.aiurClientForGame = vi.fn(async () => ({ message }) as never);
  app.route('/api/v1', previewRoutes);
  const upload = (ticket = '12', auth = SECRET, body = archive()) =>
    app.request(`http://example.test/internal/games/castle-game/previews/${ticket}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${auth}`, 'x-gm-sha': SHA },
      body,
    });
  const list = () =>
    app.request(`http://example.test/api/v1/games/${ids.game}/previews`, { headers: asUser(ids.user) });
  const answer = (buildId: string, note = 'Great') =>
    app.request(`http://example.test/api/v1/games/${ids.game}/previews/12/answer`, {
      method: 'POST',
      headers: { ...asUser(ids.user), 'content-type': 'application/json' },
      body: JSON.stringify({ buildId, verdict: 'looks right', note }),
    });
  return { deps, upload, list, answer, message };
}

describe('preview builds', () => {
  it('keeps the live branch untouched, serves the new build, and sends a verdict once', async () => {
    const { deps, upload, list, answer, message } = setup();
    expect((await upload('12', 'wrong')).status).toBe(401);
    const response = await upload();
    expect(response.status).toBe(201);
    const preview = (await response.json()) as { buildId: string };
    expect(readFileSync(join(deps.config.gamesRoot, ids.game, preview.buildId, 'index.html'), 'utf8')).toContain(
      'Fixture',
    );
    expect(deps.db.select().from(schema.builds).all()).toEqual([]);
    expect(
      deps.db.select().from(schema.branches).where(eq(schema.branches.id, ids.main)).get()?.latestBuildId,
    ).toBeNull();
    expect((await list()).status).toBe(200);
    expect(((await (await list()).json()) as { previews: unknown[] }).previews).toHaveLength(1);
    expect((await answer(preview.buildId)).status).toBe(200);
    expect(message).toHaveBeenCalledWith(
      '12',
      'Preview review: looks right.\nGreat',
      `preview:${preview.buildId}`,
      expect.any(AbortSignal),
    );
    expect((await answer(preview.buildId)).status).toBe(409);
    expect(((await (await list()).json()) as { previews: unknown[] }).previews).toHaveLength(0);
    expect(message).toHaveBeenCalledTimes(1);
  });

  it('reopens on a new push and rejects a verdict for the superseded build', async () => {
    const { upload, list, answer, message } = setup();
    const first = (await (await upload()).json()) as { buildId: string };
    const second = (await (await upload()).json()) as { buildId: string };
    expect(second.buildId).not.toBe(first.buildId);
    expect((await answer(first.buildId)).status).toBe(409);
    expect(message).not.toHaveBeenCalled();
    expect(
      ((await (await list()).json()) as { previews: { buildId: string }[] }).previews.map((p) => p.buildId),
    ).toEqual([second.buildId]);
    expect((await answer(second.buildId)).status).toBe(200);
    expect((await upload()).status).toBe(201);
    expect(((await (await list()).json()) as { previews: unknown[] }).previews).toHaveLength(1);
  });

  it('keeps a failed delivery in the queue', async () => {
    const { upload, list, answer, message } = setup();
    const preview = (await (await upload()).json()) as { buildId: string };
    message.mockRejectedValueOnce(new Error('offline'));
    expect((await answer(preview.buildId)).status).toBe(500);
    expect(((await (await list()).json()) as { previews: unknown[] }).previews).toHaveLength(1);
    expect((await answer(preview.buildId)).status).toBe(200);
  });

  it('keeps an uncertain delivery open for an idempotent retry', async () => {
    const { upload, list, answer, message } = setup();
    const preview = (await (await upload()).json()) as { buildId: string };
    message.mockResolvedValueOnce({ warning: 'outcome_unknown' });
    expect((await answer(preview.buildId)).status).toBe(500);
    expect(((await (await list()).json()) as { previews: unknown[] }).previews).toHaveLength(1);
    expect((await answer(preview.buildId)).status).toBe(200);
    expect(message.mock.calls[0]?.[2]).toBe(message.mock.calls[1]?.[2]);
  });
  it('stages cache-plan assets as blobs and keeps them through garbage collection', async () => {
    const { deps, upload } = setup();
    const files = builtFiles();
    const bytes = Buffer.from('preview image');
    const hash = createHash('sha256').update(bytes).digest('hex');
    mkdirSync(join(files, 'a'));
    writeFileSync(join(files, 'a', `${hash}.png`), bytes);
    const phase = () => ({
      boot: { bytes: 0, files: 0 },
      ready: { bytes: bytes.length, files: 1 },
      stream: { bytes: 0, files: 0 },
    });
    writeFileSync(
      join(files, 'assets', 'cache-plan.json'),
      JSON.stringify({
        version: 1,
        gameId: '',
        buildId: '',
        built: '2026-11-02T20:00:00.000Z',
        sdkVersion: '',
        tiers: ['desktop'],
        entries: [
          { sha256: hash, url: `/a/${hash}.png`, bytes: bytes.length, kind: 'sprite', phase: 'ready', tiers: ['*'] },
        ],
        totals: { desktop: phase(), mobile: phase(), low: phase() },
      }),
    );
    const body = execFileSync('tar', ['--format=ustar', '-czf', '-', '-C', files, '.']);
    const response = await upload('12', SECRET, body);
    expect(response.status).toBe(201);
    const preview = (await response.json()) as { buildId: string };
    const blob = join(deps.config.gamesRoot, '_a', `${hash}.png`);
    expect(readFileSync(blob)).toEqual(bytes);
    expect(existsSync(join(deps.config.gamesRoot, ids.game, preview.buildId, 'a'))).toBe(false);
    await gcBlobs(deps.config.gamesRoot, await previewBuildDirectories(deps));
    expect(readFileSync(blob)).toEqual(bytes);
  });
});
