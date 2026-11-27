import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { GameManifest } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { main as startGamesHost } from '@ogm/games-host';

import { createApp } from '../../src/app/app.js';
import { buildRoutes } from '../../src/builds/routes.js';
import { setup as setupDesign } from '../../src/design/routes.js';
import { ids, now, setup as setupRelease } from '../release-fixtures.js';

export { ids };
export const SECRET = 'hook-secret-for-build-tests';
export const REPO = 'everdred-games/gm-g2';
export const TICKET = '12';
export const SHA = 'e'.repeat(40);
export const CHECK_ID = 'pc_fixture';

export function manifest(): GameManifest {
  return {
    id: 'fixture',
    sdk: '^1.0.0',
    title: 'Fixture',
    inputs: { actions: {} },
    presentation: { orientation: 'any', minLogical: { w: 320, h: 180 }, fit: 'responsive' },
    view: 'topdown',
    dimension: '2d',
    capabilities: [],
    palette: { categories: [], items: [] },
    tools: [],
    gizmos: {},
    saves: false,
    controls: [],
    overrides: { aliases: {}, retired: [] },
  } as GameManifest;
}

// A game repo's built output as the hook stages it: `dist/` contents plus the manifest and the base design.
export function builtFiles(
  dir = mkdtempSync(join(tmpdir(), 'ogm-built-')),
  parts: { manifest?: boolean; design?: boolean; credits?: boolean } = {},
) {
  mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(
    join(dir, 'index.html'),
    '<!doctype html><script src="./assets/main.js"></script><title>Fixture</title>\n',
  );
  writeFileSync(join(dir, 'assets', 'main.js'), 'console.log("fixture");\n');
  if (parts.manifest ?? true) writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest()));
  if (parts.design ?? true) {
    mkdirSync(join(dir, 'design'), { recursive: true });
    writeFileSync(join(dir, 'design', 'design.json'), JSON.stringify({ schemaVersion: 1, globals: {}, entities: {} }));
  }
  if (parts.credits ?? true) writeFileSync(join(dir, 'credits.json'), JSON.stringify({ version: 1, packs: [] }));
  return dir;
}

type JobKind = (typeof schema.jobs.$inferInsert)['kind'];

// A game with its main branch, a running job for ticket 12 and the build route mounted with a fixed hook secret.
export function world(kind: JobKind = 'feature') {
  const { deps } = setupRelease();
  for (const [id, sha] of [
    [CHECK_ID, SHA],
    ['pc_newer', 'f'.repeat(40)],
  ] as const) {
    deps.db
      .insert(schema.publishChecks)
      .values({
        id,
        gameId: ids.game,
        gitSha: sha,
        surface: 'game',
        sizesJson: '[]',
        checksJson: JSON.stringify([
          { name: 'pnpm run test', result: 'passed' },
          { name: 'pnpm run build', result: 'passed' },
        ]),
        result: 'passed',
        createdAt: now,
      })
      .run();
  }
  setupDesign(deps);
  deps.db
    .insert(schema.jobs)
    .values({
      id: ids.job,
      gameId: ids.game,
      branchId: 'main',
      familyId: ids.family,
      creatorId: ids.user,
      kind,
      complexity: 1,
      state: 'running',
      start: 'now',
      slot: 'edit',
      plan: JSON.stringify({
        title: 'Double jump',
        summary: 'The hero jumps twice.',
        scope: { included: ['double jump'], excluded: [] },
        tickets: [{ key: 'T1', skills: ['gm-core'], dependsOn: [], acceptanceCriteria: ['jumps twice'] }],
      }),
      reservation: '{"amountMicroUsd":500000,"sizeClass":"small","confidence":"low"}',
      hardCapMicroUsd: 500_000,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  deps.registry.ticketJobResolver = async (repo, identifier) =>
    repo === REPO && identifier === TICKET
      ? {
          jobId: ids.job,
          gameId: ids.game,
          repo: REPO,
          kind,
          game: { title: 'Game', family: 'f', pov: 'iso', genre: 'g', multiplayer: false },
        }
      : null;
  const app = createApp(deps);
  app.route('/internal', buildRoutes({ daemonForSecret: async (secret) => (secret === SECRET ? REPO : null) }));
  return { deps, app };
}

// The Aiur feed reports the run completed (its PR merged) at `at`.
export function completeRun(deps: ReturnType<typeof world>['deps'], at = now) {
  deps.db
    .insert(schema.jobProjections)
    .values({
      jobId: ids.job,
      daemonSlug: 'everdred-games-gm-g2',
      ticket: TICKET,
      stage: 'final_tests',
      stageText: 'Final tests',
      lifecycle: 'completed',
      updatedAt: at,
    })
    .onConflictDoUpdate({ target: schema.jobProjections.jobId, set: { lifecycle: 'completed', updatedAt: at } })
    .run();
}

export function jobState(deps: ReturnType<typeof world>['deps']) {
  return deps.db.select().from(schema.jobs).all()[0]!.state;
}

// The real games host over `root` on a free loopback port.
export async function gamesHost(root: string) {
  const port = await new Promise<number>((resolve) => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      const { port: free } = probe.address() as AddressInfo;
      probe.close(() => resolve(free));
    });
  });
  const server = startGamesHost({
    OGM_GAMES_PORT: String(port),
    OGM_GAMES_ROOT: root,
    OGM_APP_ORIGIN: 'https://app.example.test',
  });
  await new Promise((resolve) => server.once('listening', resolve));
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}
