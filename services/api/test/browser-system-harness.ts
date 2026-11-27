/* The real auth route reads its environment at setup; isolate test-only values in this worker. */
import { execFile } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { serve } from '@hono/node-server';
import { schema } from '@ogm/db';

import { createChatJobDirectory } from '../src/build-chat/job-directory.js';
import { ensureMainBranch } from '../src/design/store.js';
import { createApp as createGamesHost } from '../../games-host/src/server.js';

import { makeApp, makeDeps } from './helpers.js';

const run = promisify(execFile);

/** Start the actual API routes with a private database, mail outbox and filesystem. */
export async function startBrowserSystem(appOrigin: string, editorBuildDirectory?: string) {
  const scratch = mkdtempSync(join(tmpdir(), 'ogm-browser-system-'));
  const overrides: Record<string, string> = {
    TMPDIR: scratch,
    OGM_APP_ORIGIN: appOrigin,
    OGM_SESSION_SECRET: 'local-test-session-secret-0123456789',
    OGM_WS_TOKEN_SECRET: 'local-test-websocket-secret-0123456789',
    OGM_ALLOWED_EMAILS: 'player@example.test',
    OGM_MAINTAINER_EMAILS: '',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    SMTP_URL: '',
    SMTP_FROM: '',
  };
  // eslint-disable-next-line no-restricted-properties -- test-only auth setup reads its environment at startup.
  const testEnvironment = process.env;
  const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, testEnvironment[key]]));
  Object.assign(testEnvironment, overrides);
  let deps: ReturnType<typeof makeDeps> | undefined;
  let server: ReturnType<typeof serve> | undefined;
  let gamesServer: ReturnType<typeof serve> | undefined;
  let pendingBuild: Promise<unknown> | undefined;
  let closing = false;
  const cleanup = async () => {
    closing = true;
    try {
      await pendingBuild?.catch(() => undefined);
      if (gamesServer?.listening) {
        const closing = new Promise<void>((resolve, reject) =>
          gamesServer!.close((error) => (error ? reject(error) : resolve())),
        );
        gamesServer.closeAllConnections();
        await closing;
      }
      if (server?.listening) {
        const closing = new Promise<void>((resolve, reject) =>
          server!.close((error) => (error ? reject(error) : resolve())),
        );
        server.closeAllConnections();
        await closing;
      }
    } finally {
      try {
        deps?.sqlite.close();
      } finally {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete testEnvironment[key];
          else testEnvironment[key] = value;
        }
        rmSync(scratch, { recursive: true, force: true });
      }
    }
  };
  try {
    deps = makeDeps();
    deps.config.appOrigin = appOrigin;
    deps.reviewLogPath = join(scratch, 'review-feed.log');
    const { app } = await makeApp(deps);
    server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve, reject) => {
      server!.once('listening', resolve);
      server!.once('error', reject);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('API did not bind a TCP port');
    return {
      origin: `http://127.0.0.1:${address.port}`,
      configureVoice(url: string) {
        deps!.config.voiceTokenSecret = 'local-test-voice-secret-0123456789';
        deps!.config.voiceWsUrl = url;
      },
      exhaustWeeklyJobs() {
        deps!.db.insert(schema.weeklyJobBudgets).values({ email: 'player@example.test', newGames: 0, edits: 0 }).run();
      },
      async seedEditor() {
        const gameId = 'g_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e01';
        const buildId = 'build_01BX5ZZKBKACTAV9WEVGEMMVRZ';
        const directory = join(deps!.config.gamesRoot, gameId, buildId);
        mkdirSync(directory, { recursive: true });
        // Match gm publish: Vite needs a relative base when served under /g/<game>/<build>/.
        if (editorBuildDirectory) {
          cpSync(editorBuildDirectory, directory, { recursive: true });
        } else {
          pendingBuild = run('pnpm', ['exec', 'vite', 'build', '--base=./', '--mode=draft', '--outDir', directory], {
            cwd: fileURLToPath(new URL('../../../templates/game-3d/', import.meta.url)),
          });
          await pendingBuild;
        }
        if (closing) throw new Error('system closed while staging the editor build');
        writeFileSync(join(directory, '.complete'), '');
        const branch = ensureMainBranch(deps!.sqlite, gameId);
        deps!.sqlite.prepare('UPDATE branches SET latest_build_id = ? WHERE id = ?').run(buildId, branch.id);
        const gameHost = createGamesHost({
          appOrigin,
          root: deps!.config.gamesRoot,
          version: 'test',
          workerScript: join(scratch, 'game-cache.js'),
        });
        gamesServer = serve({ fetch: gameHost.fetch, hostname: '127.0.0.1', port: 0 });
        await new Promise<void>((resolve, reject) => {
          gamesServer!.once('listening', resolve);
          gamesServer!.once('error', reject);
        });
        const address = gamesServer.address();
        if (!address || typeof address === 'string') throw new Error('games host did not bind a TCP port');
        return { origin: `http://127.0.0.1:${address.port}`, gameId, buildId };
      },
      editorTransactions: () =>
        (
          deps!.sqlite.prepare('SELECT label, commands_json FROM design_transactions ORDER BY rev').all() as {
            label: string;
            commands_json: string;
          }[]
        ).map(({ label, commands_json }) => ({ label, commands: JSON.parse(commands_json) as unknown })),
      makePlayer() {
        const owner = 'u_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e03';
        deps!.sqlite
          .prepare(
            'INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, 0, 0)',
          )
          .run(owner, 'Game owner', 'owner@example.test');
        deps!.sqlite.prepare('UPDATE families SET owner_user_id = ?').run(owner);
        deps!.sqlite.prepare("UPDATE family_members SET role = 'member', capability = 'player'").run();
        deps!.sqlite
          .prepare(
            "INSERT INTO family_members (family_id, user_id, role, capability, joined_at) SELECT id, ?, 'owner', 'creator', created_at FROM families",
          )
          .run(owner);
        deps!.sqlite.prepare("UPDATE games SET owner_id = ?, visibility = 'listed'").run(owner);
      },
      reports: () =>
        deps!.sqlite.prepare('SELECT game_id, build_hash, text FROM reports ORDER BY created_at').all() as {
          game_id: string;
          build_hash: string;
          text: string | null;
        }[],
      seedChat() {
        const user = deps!.sqlite.prepare('SELECT id FROM user WHERE email = ?').get('player@example.test') as
          { id: string } | undefined;
        if (!user) throw new Error('sign in before seeding chat');
        const at = '2026-11-01T00:00:00.000Z';
        const familyId = 'f_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e02';
        const gameId = 'g_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e01';
        const jobId = 'j_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e6f';
        deps!.db
          .insert(schema.families)
          .values({ id: familyId, name: 'Test family', ownerUserId: user.id, createdAt: at })
          .run();
        deps!.db
          .insert(schema.familyMembers)
          .values({ familyId, userId: user.id, role: 'owner', capability: 'creator', joinedAt: at })
          .run();
        deps!.db
          .insert(schema.games)
          .values({
            id: gameId,
            familyId,
            ownerId: user.id,
            title: 'Test game',
            slug: 'test-game',
            visibility: 'private',
            repoVisibility: 'private',
            createdAt: at,
          })
          .run();
        deps!.db
          .insert(schema.gameDaemons)
          .values({
            slug: 'test-game',
            repo: 'example/game',
            checkoutPath: join(scratch, 'game'),
            unit: 'test.service',
            envFile: join(scratch, 'test.env'),
            port: 43178,
            status: 'running',
            maxConcurrentAgents: 1,
            createdAt: at,
          })
          .run();
        deps!.db
          .insert(schema.jobs)
          .values({
            id: jobId,
            gameId,
            familyId,
            creatorId: user.id,
            branchId: 'main',
            kind: 'feature',
            complexity: 1,
            state: 'running',
            start: 'now',
            slot: 'edit',
            plan: JSON.stringify({
              title: 'Build a lantern',
              summary: 'Add a lantern',
              scope: { included: ['lantern'], excluded: [] },
              tickets: [{ key: 'T1', skills: [], dependsOn: [], acceptanceCriteria: ['It glows'] }],
            }),
            reservation: JSON.stringify({ amountMicroUsd: 500000, sizeClass: 'small', confidence: 'low' }),
            hardCapMicroUsd: 500000,
            aiurRepo: 'example/game',
            aiurIssueNumber: 42,
            createdAt: at,
            updatedAt: at,
          })
          .run();
        deps!.registry.chatJobs = createChatJobDirectory(deps!.db);
        return jobId;
      },
      seedReview() {
        deps!.db
          .insert(schema.reviewRounds)
          .values({
            id: 'round-local',
            gameId: 'g_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e01',
            track: 'art',
            phase: 'mock',
            category: 'art',
            round: 1,
            ticket: '42',
            sha: 'a'.repeat(40),
            media: '[]',
            question: 'Is the lantern ready?',
            postedAt: '2026-11-01T00:00:00.000Z',
          })
          .run();
      },
      reviewLog: () => readFileSync(join(scratch, 'review-feed.log'), 'utf8'),
      reviewVerdict: () =>
        deps!.sqlite.prepare('SELECT verdict, notes FROM review_rounds WHERE id = ?').get('round-local') as
          { verdict: string | null; notes: string | null } | undefined,
      chatTexts: () =>
        (
          deps!.sqlite.prepare("SELECT text FROM build_chat_messages WHERE actor = 'creator' ORDER BY seq").all() as {
            text: string;
          }[]
        ).map(({ text }) => text),
      outbox: () =>
        deps!.sqlite.prepare('SELECT text FROM mail_outbox ORDER BY created_at').all() as { text: string }[],
      close: cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
