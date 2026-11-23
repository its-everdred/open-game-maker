import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { eq } from 'drizzle-orm';
import { schema } from '@ogm/db';
import { describe, expect, it } from 'vitest';

import { setPaidApisDuringGameplay } from '../../src/gameplay/policy.js';
import { buildRoutes } from '../../src/builds/routes.js';
import { createApp } from '../../src/app/app.js';
import { listEditorPreviews } from '../../src/previews/store.js';
import { seededApp, X } from '../admin-fixture.js';
import { ids, REPO, SECRET, SHA, world } from '../builds/fixtures.js';
import { asUser } from '../helpers.js';

// The requests ops/bin/ogm-qa-paid-apis sends on prod after every deploy (#1221). It must prove the paid-API gate
// without ever spending: each body is one the route rejects after the gate, so a broken gate still dispatches nothing.
const CHECK = fileURLToPath(new URL('../../../../ops/bin/ogm-qa-paid-apis', import.meta.url));
const GAMES = 'https://games.example.test';
const APP = 'https://app.example.test';

// The preview archive the check uploads, built by the check itself.
function checkArchive(): Buffer {
  const script = `import runpy, sys; sys.stdout.buffer.write(runpy.run_path(sys.argv[1])['preview_archive']())`;
  return execFileSync('python3', ['-I', '-c', script, CHECK]);
}

type App = Awaited<ReturnType<typeof seededApp>>['app'];
const requests = [
  ['/api/v1/voice/token', '{}'],
  ['/api/v1/voice/dictation-token', '{}'],
  [`/api/v1/games/${X.game}/narration/render`, '{"lines":[]}'],
] as const;

function send(app: App, path: string, body: string, origin: string) {
  return app.request(path, {
    method: 'POST',
    headers: { ...asUser(X.creator.userId), 'content-type': 'application/json', origin },
    body,
  });
}

async function code(response: Response): Promise<unknown> {
  const { error } = (await response.json()) as { error?: unknown };
  return typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : error;
}

describe('the post-deploy paid-API check', () => {
  it("gets the gate's refusal for each of its requests from the games origin", async () => {
    const { app } = await seededApp();
    for (const [path, body] of requests) {
      const response = await send(app, path, body, GAMES);
      expect(response.status, path).toBe(403);
      expect(await code(response), path).toBe('paid_apis_off_during_gameplay');
    }
  });

  it('sends nothing a route would dispatch when the gate lets it through', async () => {
    const { app, deps } = await seededApp();
    setPaidApisDuringGameplay(deps.db, true);
    for (const [path, body] of requests) {
      const response = await send(app, path, body, GAMES);
      // 400 is the body refused, 503 no provider wired: both after the gate and before any paid call.
      expect([400, 503], path).toContain(response.status);
    }
    for (const [path, body] of requests) expect([400, 503]).toContain((await send(app, path, body, APP)).status);
  });

  it('uploads a preview that the paid-host scan refuses and that nothing after it would install', async () => {
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
    deps.db
      .update(schema.games)
      .set({ githubOwner: owner, githubRepo: repo })
      .where(eq(schema.games.id, ids.game))
      .run();
    const upload = () =>
      app.request('http://example.test/internal/games/castle-game/previews/999999999999', {
        method: 'POST',
        headers: { authorization: `Bearer ${SECRET}`, 'x-gm-sha': SHA, 'content-type': 'application/gzip' },
        body: checkArchive(),
      });

    const refused = await upload();
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({ error: { code: 'paid_integration' } });

    // With the scan out of the way the archive passes every earlier check and fails the first one after it: a broken
    // scan refuses it too, under another code the check reports, and installs nothing on the game.
    setPaidApisDuringGameplay(deps.db, true);
    const passed = await upload();
    expect(passed.status).toBe(422);
    expect(await passed.json()).toEqual({ error: { code: 'cache_plan_invalid' } });
    expect(await listEditorPreviews(deps, ids.game)).toEqual([]);
  });
});
