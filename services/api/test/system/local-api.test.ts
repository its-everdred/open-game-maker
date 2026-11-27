import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';
import { NullRepoProvisioner } from '../../src/games/repo-provisioner.js';
import { asUser } from '../helpers.js';
import { startLocalApi } from './local-api.js';

it('serves the real API with the test principal only when supplied', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ogm-system-api-'));
  let api: Awaited<ReturnType<typeof startLocalApi>> | undefined;
  try {
    const provisioner = new NullRepoProvisioner();
    api = await startLocalApi(root, { repoProvisioner: provisioner });
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
    expect(provisioner.calls).toHaveLength(1);
  } finally {
    await api?.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 120_000);
