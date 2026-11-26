import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { command } from '../src/commands/qa/play-check.js';
import { tempDir } from './helpers.js';

const acquireSlot = vi.hoisted(() => vi.fn());
vi.mock('@ogm/gm-verify', () => ({ acquireSlot }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('qa play-check published build', () => {
  it('retries a publish race and reports a capture-slot failure after fetching', async () => {
    const root = tempDir();
    try {
      const env = join(root, 'env');
      mkdirSync(env);
      writeFileSync(
        join(env, 'api.env'),
        'OGM_APP_ORIGIN=https://app.example.test\nOGM_GAMES_ORIGIN=https://games.example.test\n',
      );
      writeFileSync(join(env, 'qa.env'), 'OGM_QA_SESSION_COOKIE_NAME=session\nOGM_QA_SESSION_COOKIE=value\n');
      let manifestAttempts = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: URL) => {
          if (url.pathname.endsWith('manifest.json') && manifestAttempts++ === 0)
            return new Response(null, { status: 404 });
          return new Response('{}', { status: 200 });
        }),
      );
      acquireSlot.mockRejectedValueOnce(new Error('no free capture slot after 90000 ms'));
      const ctx = {
        cwd: root,
        assetsRoot: null,
        skillsDir: null,
        config: { verifySoftwareGl: true, verifyQueue: true },
        json: false,
        limit: 10,
        fields: null,
        out() {},
        err() {},
        emit() {},
        blobRoot: null,
        env: { OGM_ENV_DIR: env },
      };
      expect(await command.run(ctx, ['game', 'build'], { out: 'out', timeout: 170, stall: 0 })).toBe(1);
      const report = JSON.parse(readFileSync(join(root, 'out/play-check.json'), 'utf8'));
      expect(manifestAttempts).toBe(2);
      expect(report.failures).toEqual([expect.stringContaining('capture slot: no free capture slot')]);
      expect(acquireSlot).toHaveBeenCalledWith(expect.objectContaining({ waitMs: 90_000 }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 10_000);
});
