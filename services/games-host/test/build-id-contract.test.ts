import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StableIdSchema } from '@ogm/contracts';

import { markComplete } from '../src/layout.js';
import { createApp } from '../src/server.js';

/* The API validates game and build ids with StableIdSchema (the branch switch body included); the games host must
   serve a build stored under those exact ids, or every build switched through the API 404s here. */
const GAME_ID = 'g_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const BUILD_ID = 'b_01BX5ZZKBKACTAV9WEVGEMMVRZ';

describe('build id contract between the API and the games host', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ogm-games-contract-'));
    const build = join(root, GAME_ID, BUILD_ID);
    await mkdir(build, { recursive: true });
    await writeFile(join(build, 'index.html'), '<h1>switched</h1>');
    await markComplete(build);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function app() {
    return createApp({
      root,
      accessCheck: async () => true,
      blobOwners: async () => ['demo'],
      appOrigin: 'https://makeopen.games',
      version: '0123456789abcdef0123456789abcdef01234567',
      uptimeSec: () => 0,
      workerScript: join(root, 'unused-worker.js'),
    });
  }

  it('serves a build under the same ULID ids the API accepts', async () => {
    expect(StableIdSchema.safeParse(GAME_ID).success).toBe(true);
    expect(StableIdSchema.safeParse(BUILD_ID).success).toBe(true);

    const response = await app().request(`/g/${GAME_ID}/${BUILD_ID}/`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<h1>switched</h1>');
  });

  it.each([`/g/%2e%2e/${BUILD_ID}/`, `/g/${GAME_ID}/%2e%2e/`, `/g/${GAME_ID}/B_01BX5ZZKBKACTAV9WEVGEMMVRZ/`])(
    'still refuses ids outside both shapes: %s',
    async (path) => {
      expect((await app().request(path)).status).toBe(404);
    },
  );
});
