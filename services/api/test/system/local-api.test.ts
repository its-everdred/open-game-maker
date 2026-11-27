import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';
import { createLocalInstance } from '../../../../apps/web/e2e/support/local-instance.js';
import { asUser } from '../helpers.js';
import { startLocalApi } from './local-api.js';
import { localProvisioner } from './local-provisioner.js';

it('serves the real API with the test principal only when supplied', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ogm-system-api-'));
  let instance: ReturnType<typeof createLocalInstance> | undefined;
  let api: Awaited<ReturnType<typeof startLocalApi>> | undefined;
  try {
    instance = createLocalInstance();
    api = await startLocalApi(root, { repoProvisioner: localProvisioner(instance.checkout, instance.bare) });
    expect((await fetch(`${api.origin}/api/v1/games`)).status).toBe(401);
    const response = await fetch(`${api.origin}/api/v1/games`, { headers: asUser(api.userId) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ games: [] });
    const created = await fetch(`${api.origin}/api/v1/games`, {
      method: 'POST',
      headers: { ...asUser(api.userId), 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'System game', repoVisibility: 'private' }),
    });
    expect(created.status).toBe(201);
    const game = (await created.json()) as { slug: string };
    expect(
      execFileSync('git', ['--git-dir', instance.bare, 'show', `main:games/${game.slug}/package.json`], {
        encoding: 'utf8',
      }),
    ).toContain('name');
  } finally {
    await api?.close();
    rmSync(root, { recursive: true, force: true });
    instance?.cleanup();
  }
}, 120_000);
