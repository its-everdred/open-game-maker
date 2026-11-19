import { createHash, timingSafeEqual } from 'node:crypto';

import { getConnInfo } from '@hono/node-server/conninfo';
import { CommitOp as CommitOpSchema } from '@ogm/contracts';
import { Hono } from 'hono';
import type { Context } from 'hono';

import type { AuditEntry, AuditWriter } from './audit.js';
import { GitHubOAuthNotConfiguredError } from './auth/app.js';
import type { ActiveRepository } from './boundary/api-client.js';
import type { BoundaryCheck } from './boundary/poller.js';
import { registerBoundaryWebhook } from './boundary/webhook.js';
import type { OperationContext, RepositoryResolver } from './ops/context.js';
import { executeOperation } from './ops/registry.js';
import type { CommitOp, CommitResult, GameRepository, GitHubInstallations } from './types.js';
import type { QaCreateFence } from './qa-create-fence.js';

type ServerDependencies = {
  serviceToken: string;
  operations: Omit<OperationContext, 'repos'>;
  repos: RepositoryResolver;
  audit: AuditWriter;
  qaCreateFence?: QaCreateFence;
  installations?: GitHubInstallations;
  remoteAddress?: (context: Context) => string | undefined;
  execute?: (op: CommitOp, context: OperationContext) => Promise<CommitResult>;
  now?: () => Date;
  boundaryWebhook?: {
    secret: string | undefined;
    resolveRepository(owner: string, name: string): Promise<ActiveRepository[]>;
    run: BoundaryCheck;
    onError?(error: unknown): void;
  };
};

function tokenMatches(expected: string, authorization: string | undefined): boolean {
  if (!authorization?.startsWith('Bearer ')) return false;
  const received = authorization.slice('Bearer '.length);
  const expectedDigest = createHash('sha256').update(expected).digest();
  const receivedDigest = createHash('sha256').update(received).digest();
  return timingSafeEqual(expectedDigest, receivedDigest);
}

function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function gameIdOf(op: CommitOp): string {
  if (op.kind === 'file_issue') return op.gameId ?? 'platform';
  return op.gameId;
}

async function repoNameFor(op: CommitOp, context: OperationContext): Promise<string> {
  if (op.kind === 'file_issue' && op.gameId === undefined) {
    return `${context.platformIssueRepo.owner}/${context.platformIssueRepo.name}`;
  }
  const repo = await context.repos.resolve(gameIdOf(op));
  return `${repo.owner}/${repo.name}`;
}

function memoizedRepos(source: RepositoryResolver): RepositoryResolver {
  const values = new Map<string, Promise<GameRepository>>();
  return {
    resolve(gameId: string): Promise<GameRepository> {
      const existing = values.get(gameId);
      if (existing !== undefined) return existing;
      const pending = source.resolve(gameId);
      values.set(gameId, pending);
      return pending;
    },
  };
}

export function createCommitApp(dependencies: ServerDependencies): Hono {
  if (Buffer.byteLength(dependencies.serviceToken, 'utf8') < 32) {
    throw new Error('OGM_COMMIT_SERVICE_TOKEN must be at least 32 bytes');
  }
  const app = new Hono();
  const creating = new Set<string>();
  const startedAt = Date.now();
  const remoteAddress = dependencies.remoteAddress ?? ((context: Context) => getConnInfo(context).remote.address);

  app.get('/healthz', (context) =>
    context.json({
      ok: true,
      service: 'commit',
      version: '0.0.0',
      uptimeSec: Math.floor((Date.now() - startedAt) / 1_000),
    }),
  );

  if (dependencies.boundaryWebhook !== undefined) {
    registerBoundaryWebhook(app, dependencies.boundaryWebhook);
  }

  const refuseCaller = (context: Context): Response | undefined => {
    if (!isLoopback(remoteAddress(context))) return context.json({ error: 'loopback required' }, 403);
    if (!tokenMatches(dependencies.serviceToken, context.req.header('authorization'))) {
      return context.json({ error: 'unauthorized' }, 401);
    }
    return undefined;
  };

  app.post('/internal/qa/create-fence/:id', async (context) => {
    const refused = refuseCaller(context);
    if (refused !== undefined) return refused;
    if (!dependencies.qaCreateFence) return context.json({ error: 'fence_unavailable' }, 503);
    const id = context.req.param('id');
    const body = (await context.req.json().catch(() => null)) as { owner?: unknown } | null;
    if (!/^g_[A-Za-z0-9_-]+$/u.test(id) || typeof body?.owner !== 'string' || !/^[a-z0-9-]{1,40}$/u.test(body.owner))
      return context.json({ error: 'invalid_fence' }, 400);
    try {
      return context.json({ ready: await dependencies.qaCreateFence.acquire(id, body.owner) });
    } catch {
      return context.json({ error: 'fence_conflict' }, 409);
    }
  });

  app.delete('/internal/qa/create-fence/:id', async (context) => {
    const refused = refuseCaller(context);
    if (refused !== undefined) return refused;
    if (!dependencies.qaCreateFence) return context.json({ error: 'fence_unavailable' }, 503);
    const id = context.req.param('id');
    const body = (await context.req.json().catch(() => null)) as { owner?: unknown } | null;
    if (!/^g_[A-Za-z0-9_-]+$/u.test(id) || typeof body?.owner !== 'string' || !/^[a-z0-9-]{1,40}$/u.test(body.owner))
      return context.json({ error: 'invalid_fence' }, 400);
    try {
      await dependencies.qaCreateFence.release(id, body.owner);
      return context.json({ released: true });
    } catch {
      return context.json({ error: 'fence_conflict' }, 409);
    }
  });

  app.get('/internal/qa/create-audit/:id', async (context) => {
    const refused = refuseCaller(context);
    if (refused !== undefined) return refused;
    if (!dependencies.qaCreateFence) return context.json({ error: 'fence_unavailable' }, 503);
    const id = context.req.param('id');
    if (!/^g_[A-Za-z0-9_-]+$/u.test(id)) return context.json({ error: 'invalid_game' }, 400);
    try {
      return context.json({ terminal: await dependencies.qaCreateFence.hasTerminalAudit(id) });
    } catch {
      return context.json({ error: 'audit_unavailable' }, 503);
    }
  });

  // The API resolves the account behind an installation id the browser brought back from GitHub (#280). A login is
  // only returned for an installation the user who authorized `code` controls, so learning an id proves nothing.
  app.post('/internal/installations/:id/ownership', async (context) => {
    const refused = refuseCaller(context);
    if (refused !== undefined) return refused;
    const id = context.req.param('id');
    if (!/^[1-9][0-9]{0,14}$/u.test(id)) return context.json({ error: 'installation_not_found' }, 404);
    const installations = dependencies.installations;
    if (installations === undefined) return context.json({ error: 'installations unavailable' }, 503);
    const body = (await context.req.json().catch(() => undefined)) as unknown;
    const code = typeof body === 'object' && body !== null && 'code' in body ? body.code : undefined;
    if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{1,255}$/u.test(code)) {
      return context.json({ error: 'code_required' }, 422);
    }
    let login: string | null;
    try {
      login = await installations.installationLoginForUser(Number(id), code);
    } catch (error) {
      if (error instanceof GitHubOAuthNotConfiguredError) {
        return context.json({ error: 'github_oauth_unavailable' }, 503);
      }
      return context.json({ error: 'installation lookup failed' }, 502);
    }
    if (login === null) return context.json({ error: 'installation_not_found' }, 404);
    return context.json({ login }, 200);
  });

  /*
   * Revalidates an installation the API already stored for a creator, so a screen stops claiming "Connected" after
   * the App is uninstalled or access is revoked. This never grants a connection: the API only asks about ids it has
   * already proven and stored.
   */
  app.get('/internal/installations/:id', async (context) => {
    const refused = refuseCaller(context);
    if (refused !== undefined) return refused;
    const id = context.req.param('id');
    const installations = dependencies.installations;
    if (installations === undefined) return context.json({ error: 'installations unavailable' }, 503);
    if (!/^[1-9][0-9]{0,14}$/u.test(id)) return context.json({ error: 'installation_not_found' }, 404);
    let login: string | null;
    try {
      login = await installations.installationLogin(Number(id));
    } catch {
      return context.json({ error: 'installation lookup failed' }, 502);
    }
    if (login === null) return context.json({ error: 'installation_not_found' }, 404);
    return context.json({ login }, 200);
  });

  app.post('/internal/commit', async (context) => {
    const refused = refuseCaller(context);
    if (refused !== undefined) return refused;
    const parsed = CommitOpSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) {
      return context.json({ error: { code: 'invalid_op', issues: parsed.error.issues } }, 422);
    }

    const createId = parsed.data.kind === 'create_game' ? parsed.data.gameId : undefined;
    if (createId !== undefined && creating.has(createId)) return context.json({ error: 'create_in_progress' }, 409);
    if (createId !== undefined) creating.add(createId);
    try {
      const endCreate =
        parsed.data.kind === 'create_game' && dependencies.qaCreateFence
          ? await dependencies.qaCreateFence.begin(parsed.data.gameId)
          : undefined;
      if (endCreate === null) return context.json({ error: 'create_fenced' }, 409);

      const operationContext: OperationContext = {
        ...dependencies.operations,
        repos: memoizedRepos(dependencies.repos),
      };
      const execute = dependencies.execute ?? executeOperation;
      let result: CommitResult | undefined;
      let failure: unknown;
      try {
        result = await execute(parsed.data, operationContext);
      } catch (error) {
        failure = error;
      }

      const entry: AuditEntry = {
        at: (dependencies.now ?? (() => new Date()))().toISOString(),
        op: parsed.data.kind,
        gameId: gameIdOf(parsed.data),
        repo: await repoNameFor(parsed.data, operationContext).catch(() => 'unresolved'),
        result: failure === undefined ? (result?.ok === true ? 'allowed' : 'refused') : 'error',
        ...(result?.ok === true ? { sha: result.sha } : {}),
        ...(result?.ok === false ? { verdict: result.verdict } : {}),
        actor: 'api',
      };
      await dependencies.audit.append(entry);
      // A returned verdict is terminal; exceptions may have taken effect despite a lost response.
      if (endCreate && failure === undefined && result !== undefined) await endCreate();
      if (failure !== undefined) return context.json({ error: 'commit operation failed' }, 502);
      return context.json(result as CommitResult, 200);
    } finally {
      if (createId !== undefined) creating.delete(createId);
    }
  });
  return app;
}
