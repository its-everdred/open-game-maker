import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { gm, tempDir } from './helpers.js';

describe('gm qa new-game-e2e', () => {
  it('fails before launching when credentials are missing or the internal API is not loopback', async () => {
    const home = tempDir();
    try {
      const env = join(home, '.config', 'ogm', 'env');
      mkdirSync(env, { recursive: true });
      writeFileSync(
        join(env, 'api.env'),
        'OGM_APP_ORIGIN=https://app.example.test\nOGM_API_PORT=4300\nOGM_INTERNAL_TOKEN=secret\nOGM_INSTANCE_REPO=example/games\nOGM_QA_INSTANCE_REPO=example/qa\n',
      );
      const missing = await gm(['qa', 'new-game-e2e'], { home });
      expect(missing.code).toBe(1);
      expect(missing.out.at(-1)).toBe('exit=1 qa-new-game-e2e');
      writeFileSync(join(env, 'qa.env'), 'OGM_QA_SESSION_COOKIE_NAME=session\nOGM_QA_SESSION_COOKIE=value\n');
      writeFileSync(
        join(env, 'api.env'),
        'OGM_APP_ORIGIN=https://app.example.test\nOGM_API_PORT=4300\nOGM_INTERNAL_TOKEN=secret\nOGM_INSTANCE_REPO=example/games\nOGM_QA_INSTANCE_REPO=EXAMPLE/GAMES\n',
      );
      const sameRepo = await gm(['qa', 'new-game-e2e'], { home });
      expect(sameRepo.code).toBe(1);
      expect(sameRepo.err.join(' ')).toContain('configuration');
      writeFileSync(
        join(env, 'api.env'),
        'OGM_APP_ORIGIN=https://app.example.test\nOGM_API_PORT=4300\nOGM_INTERNAL_TOKEN=secret\nOGM_INSTANCE_REPO=example/games\nOGM_QA_INSTANCE_REPO=example/qa\n',
      );
      writeFileSync(
        join(env, 'ogm-commit.env'),
        'OGM_COMMIT_PORT=4301\nOGM_COMMIT_SERVICE_TOKEN=secret\nOGM_DATA_DIR=/tmp/test\n',
      );
      const unsafe = await gm(['qa', 'new-game-e2e', '--api', 'https://other.example.test'], { home });
      expect(unsafe.code).toBe(1);
      expect(unsafe.err.join(' ')).toContain('loopback');
      expect(unsafe.out.at(-1)).toBe('exit=1 qa-new-game-e2e');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 60_000);
});
