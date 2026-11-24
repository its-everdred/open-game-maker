import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { schema } from '@ogm/db';
import { describe, expect, it } from 'vitest';

import { asUser, installUsers, makeApp, makeDeps, type TestUser } from './helpers.js';

const LISTENER = fileURLToPath(new URL('../../../ops/bin/ogm-telemetry-listen', import.meta.url));

const kevin: TestUser = {
  kind: 'user',
  userId: 'u-kevin',
  displayName: 'Kevin',
  email: 'kevin@example.test',
  familyId: 'f-telemetry',
  platformRole: 'admin',
  capability: 'creator',
};

/*
 * The issue's proof, end to end on the real API and the real listener: a crash thrown in-world and a blocked script
 * become crash groups as soon as the API answers, and the Executor's attention file and a crash issue have them within a
 * minute of the crash (one listener pass; the service runs one every 15 s).
 */
describe('crash telemetry to the Executor', () => {
  it('reaches the attention file and a crash issue within a minute of a forced crash', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ogm-telemetry-proof-'));
    const db = join(dir, 'ogm.sqlite3');
    const attention = join(dir, 'aiur-replies.md');
    const calls = join(dir, 'gh.calls');
    const gh = join(dir, 'gh');
    writeFileSync(
      gh,
      `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> '${calls}'\n[[ "$1 $2" == 'issue create' ]] && echo https://github.com/o/r/issues/9\nexit 0\n`,
    );
    chmodSync(gh, 0o755);
    const listen = () =>
      execFileSync(LISTENER, ['--db', db, '--state', join(dir, 'state.json'), '--attention', attention, '--once'], {
        env: { ...process.env, OGM_GH: gh, OGM_ENV_DIR: dir },
        encoding: 'utf8',
      });

    const deps = makeDeps();
    installUsers(deps, [kevin]);
    deps.sqlite
      .prepare('INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, 0, 0)')
      .run(kevin.userId, kevin.displayName, kevin.email);
    const createdAt = new Date().toISOString();
    deps.db
      .insert(schema.families)
      .values({ id: kevin.familyId, name: 'Family', ownerUserId: kevin.userId, createdAt })
      .run();
    deps.db
      .insert(schema.games)
      .values({
        id: 'g_proof',
        familyId: kevin.familyId,
        ownerId: kevin.userId,
        title: 'Proof',
        slug: 'proof',
        visibility: 'listed',
        repoVisibility: 'private',
        createdAt,
      })
      .run();
    const { app } = await makeApp(deps);
    await deps.sqlite.backup(db);
    listen(); // first pass: starts from now

    const base = {
      at: new Date().toISOString(),
      sessionId: randomUUID(),
      origin: 'https://gm.example',
      appVersion: 'abc1234',
      device: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1',
      gameId: 'g_proof',
      buildId: 'b_proof',
    };
    const crashedAt = Date.now();
    const response = await app.request('/api/v1/telemetry/client-events', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...asUser(kevin.userId) },
      body: JSON.stringify({
        events: [
          { ...base, kind: 'app_open', resumed: false },
          {
            ...base,
            kind: 'crash',
            crash: 'game_error',
            step: 'in-world',
            message: 'Error: forced in-world crash',
            stack: 'Error: forced\n    at tick (https://games.example/g/g_proof/b_proof/main.js:3:9)',
            breadcrumbs: ['open game g_proof build b_proof', 'first frame', 'in world'],
          },
          {
            ...base,
            kind: 'crash',
            crash: 'csp_violation',
            step: 'loading',
            message: 'script-src blocked https://cdn.example/restore.js',
            breadcrumbs: [],
          },
        ],
      }),
    });
    expect(response.status).toBe(202);
    expect(deps.sqlite.prepare('SELECT crash FROM crash_groups ORDER BY crash').all()).toEqual([
      { crash: 'csp_violation' },
      { crash: 'game_error' },
    ]);

    await deps.sqlite.backup(db);
    listen();
    const lines = readFileSync(attention, 'utf8').trim().split('\n');
    expect(Date.now() - crashedAt).toBeLessThan(60_000);
    expect(lines).toEqual([
      expect.stringContaining('telemetry: crash game_error in proof build b_proof'),
      expect.stringContaining('telemetry: crash csp_violation in proof build b_proof'),
      expect.stringContaining('telemetry: app opened by Kevin on iPhone Safari at https://gm.example (app abc1234)'),
    ]);
    const filed = readFileSync(calls, 'utf8');
    expect(filed).toContain('issue create -R its-everdred/open-game-maker --title Crash: game_error in proof');
    expect(filed).toContain('--title Crash: csp_violation in proof');
  });
});
