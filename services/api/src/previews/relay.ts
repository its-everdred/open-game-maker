import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readFile, readdir, readlink, realpath, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import { Readable } from 'node:stream';

import { schema } from '@ogm/db';
import { ReviewSubmission } from '@ogm/contracts';
import { liveWorkspaceReady } from './live-workspace.js';

import type { AppDeps } from '../app/types.js';
import { ARCHIVE_LIMITS } from '../builds/untar.js';
import { mintPreviewToken, verifyPreviewToken } from '../builds/preview-token.js';
import { findGameBySlugOrId } from '../games/slug.js';
import { hookPreviewToken } from '../internal/bundle.js';
import { createPreview } from './store.js';
import { submitRelayedReview } from '../review-rounds/relay.js';
import { reviewDaemonForGame } from '../review-rounds/daemon.js';
import { readTrack, reviewCheckout } from '../review-rounds/tracks.js';
import { phaseOwner } from '../review-rounds/owners.js';
import { submitRound } from '../review-rounds/store.js';
import { withArtifactMutation } from '../builds/artifact-lock.js';
import { plannerRequest } from './new-game.js';
import { newGameContext } from '../new-game/context.js';
import { getAttachment, readBlob } from '../build-chat/attachments.js';
import { admitPlannerChild, plannerChildStatus } from './planner-child.js';
import { HttpError } from '../app/errors.js';
import { AdmissionRefused } from '../jobs/admission.js';
import { plannerAnswers } from '../job-commands/planner-answers.js';
import { plannerCheckpointBranch } from './planner-base.js';
import { and, eq, sql } from 'drizzle-orm';
import type { PreviewTicketVerifier } from './ticket.js';

const requestName = /^[0-9a-f-]{36}\.json$/u;
const SHA = /^[0-9a-f]{40}$/u;
const ticketPattern = /^[1-9]\d{0,15}$/u;
const branchPattern = /^[A-Za-z0-9_-]{1,200}$/u;

const refreshAttempts = new Map<string, number>();
type Request = {
  state: string;
  token: string;
  ticket: string;
  slug: string;
  sha: string;
  branch: string;
  kind?: string;
  submission?: unknown;
  attachments?: unknown;
  attachment?: string;
  child?: unknown;
  childKey?: string;
  plannerBranch?: string;
};
type RepoGrant = { repo: string; ticket: string; game: string; grant: string; secret: string; workspace: string };

// Check the opened descriptor, not only the path: workers control every workspace directory.
async function openWithin(file: string, directory: string, flags: number) {
  const handle = await open(file, flags | constants.O_NOFOLLOW);
  try {
    const actual = await readlink(`/proc/self/fd/${handle.fd}`);
    const stat = await handle.stat();
    if (!actual.startsWith(directory + sep) || !stat.isFile() || stat.nlink !== 1) throw new Error('unsafe_file');
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function processRequest(
  deps: AppDeps,
  home: string,
  dir: string,
  filename: string,
  verifyTicket: PreviewTicketVerifier,
  repoGrant?: RepoGrant,
): Promise<void> {
  let request;
  let directory;
  let response;
  try {
    directory = await open(dir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    if ((await readlink(`/proc/self/fd/${directory.fd}`)) !== dir) return;
    request = await openWithin(join(dir, filename), dir, constants.O_RDONLY);
    if ((await request.stat()).size > 65536) return;
    const requestBuffer = Buffer.alloc(65537);
    const requestRead = await request.read(requestBuffer, 0, requestBuffer.length, 0);
    if (requestRead.bytesRead > 65536) return;
    const data = JSON.parse(requestBuffer.subarray(0, requestRead.bytesRead).toString('utf8')) as Request;
    if (data.state !== 'pending') return;
    response = await open(
      `/proc/self/fd/${directory.fd}/${filename.replace(/\.json$/u, '.response')}`,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    let result: Record<string, string | number>;
    try {
      if (
        typeof data.token !== 'string' ||
        typeof data.ticket !== 'string' ||
        !ticketPattern.test(data.ticket) ||
        !Number.isSafeInteger(Number(data.ticket)) ||
        typeof data.slug !== 'string' ||
        typeof data.sha !== 'string' ||
        !SHA.test(data.sha) ||
        typeof data.branch !== 'string' ||
        !branchPattern.test(data.branch)
      )
        throw new Error('invalid_request');
      const game = findGameBySlugOrId(deps.db, data.slug);
      const workspace = join(dir, '..', '..');
      let authorized = false;
      if (repoGrant) {
        const claims = verifyPreviewToken(data.token, repoGrant.secret);
        authorized =
          !!claims &&
          claims.ticket === data.ticket &&
          claims.game === data.slug &&
          claims.game === repoGrant.game &&
          claims.ticket === repoGrant.ticket &&
          claims.grant === repoGrant.grant &&
          workspace === repoGrant.workspace &&
          !!game?.githubOwner &&
          !!game.githubRepo &&
          `${game.githubOwner}/${game.githubRepo}`.toLowerCase() === repoGrant.repo;
      } else {
        const identity = await hookPreviewToken(home)(data.token, deps);
        const workspaceHash = createHash('sha256').update(workspace).digest('hex');
        const grantFile = identity
          ? join(home, '.config/ogm/daemons', identity.slug, 'preview-grants', `${workspaceHash}.json`)
          : '';
        const grant = identity
          ? await readFile(grantFile, 'utf8').then(
              (text) => JSON.parse(text) as { ticket?: string; grant?: string },
              () => null,
            )
          : null;
        authorized =
          !!identity &&
          identity.ticket === data.ticket &&
          identity.game === data.slug &&
          !!grant &&
          grant.ticket === identity.ticket &&
          grant.grant === identity.grant &&
          !!game?.githubOwner &&
          !!game.githubRepo &&
          findGameBySlugOrId(deps.db, identity.slug)?.id === game.id &&
          `${game.githubOwner}/${game.githubRepo}`.toLowerCase() === identity.repo.toLowerCase();
      }
      if (
        !authorized ||
        !game ||
        !game.githubOwner ||
        !game.githubRepo ||
        !(await verifyTicket(`${game.githubOwner}/${game.githubRepo}`, data.ticket, data.slug, !!repoGrant))
      )
        throw new Error('unauthorized');
      if (data.kind === 'planner-worker-context') {
        const repo = `${game.githubOwner}/${game.githubRepo}`.toLowerCase();
        const job = deps.db
          .select({
            id: schema.jobs.id,
            plan: schema.jobs.plan,
            key: schema.jobs.idempotencyKey,
            state: schema.jobs.state,
          })
          .from(schema.jobTickets)
          .innerJoin(schema.jobs, eq(schema.jobs.id, schema.jobTickets.jobId))
          .where(
            and(
              eq(schema.jobTickets.issueNumber, Number(data.ticket)),
              sql`lower(${schema.jobTickets.repo}) = ${repo}`,
              eq(schema.jobs.gameId, game.id),
            ),
          )
          .get();
        if (!job?.key?.startsWith('planner:')) {
          await response.writeFile(Buffer.from(JSON.stringify({ state: 'done', result: { plannerChild: false } })));
          return;
        }
        if (!['admitted', 'filed', 'running', 'paused_budget'].includes(job.state))
          throw new HttpError(409, 'planner_child_not_admitted');
        const base = (JSON.parse(job.plan) as { _plannerBase?: unknown })._plannerBase;
        if (
          !base ||
          typeof base !== 'object' ||
          !('branch' in base) ||
          !('sha' in base) ||
          typeof base.branch !== 'string' ||
          typeof base.sha !== 'string' ||
          !SHA.test(base.sha)
        )
          throw new Error('invalid_planner_base');
        const answers = plannerAnswers(deps.db, deps.sqlite, { jobId: job.id, gameId: game.id });
        await response.writeFile(
          Buffer.from(JSON.stringify({ state: 'done', result: { plannerChild: true, base, answers } })),
        );
        return;
      }
      if (
        ['new-game-context', 'new-game-attachment', 'new-game-child', 'new-game-child-status'].includes(data.kind ?? '')
      ) {
        const repo = `${game.githubOwner}/${game.githubRepo}`.toLowerCase();
        const requestId = plannerRequest(deps.db, repo, Number(data.ticket), game.id);
        if (!requestId) throw new Error('unauthorized');
        if (data.kind === 'new-game-child' || data.kind === 'new-game-child-status') {
          let childResult;
          if (data.kind === 'new-game-child') {
            const base = { branch: data.plannerBranch ?? '', sha: data.sha };
            if (
              !deps.registry.plannerBaseVerifier ||
              !(await deps.registry.plannerBaseVerifier(
                repo,
                workspace,
                data.slug,
                base,
                typeof data.child === 'object' && data.child !== null && 'decisions' in data.child
                  ? data.child.decisions
                  : undefined,
              ))
            )
              throw new HttpError(409, 'invalid_planner_base');
            childResult = await admitPlannerChild(deps, requestId, data.child, {
              ...base,
              branch: plannerCheckpointBranch(base.sha),
            });
          } else childResult = plannerChildStatus(deps, requestId, data.childKey ?? '');
          await response.writeFile(Buffer.from(JSON.stringify({ state: 'done', result: childResult })));
          return;
        }
        const context = newGameContext(deps.db, deps.sqlite, requestId);
        if (!context) throw new Error('unauthorized');
        let result: unknown = context;
        if (data.kind === 'new-game-attachment') {
          const attachment = context.attachments.find((item) => item.id === data.attachment);
          const row = attachment && getAttachment(deps.sqlite, attachment.id);
          const bytes = row && (await readBlob(deps.blobStore, row.blobHash));
          if (!attachment || !bytes || !plannerRequest(deps.db, repo, Number(data.ticket), game.id))
            throw new Error('unauthorized');
          result = { id: attachment.id, data: Buffer.from(bytes).toString('base64') };
        }
        await response.writeFile(Buffer.from(JSON.stringify({ state: 'done', result })));
        return;
      }
      if (data.kind === 'review') {
        if (
          !data.submission ||
          typeof data.submission !== 'object' ||
          !('ticket' in data.submission) ||
          data.submission.ticket !== data.ticket ||
          !('sha' in data.submission) ||
          data.submission.sha !== data.sha
        )
          throw new Error('invalid_request');
        const submission = ReviewSubmission.safeParse(data.submission);
        const attachments = data.attachments ?? [];
        if (!submission.success || !Array.isArray(attachments)) throw new Error('invalid_request');
        const liveBuilds = submission.data.media.filter(
          (item) => item.kind === 'build' && item.ref.startsWith('live-'),
        );
        let authorizedLive = false;
        if (liveBuilds.length) {
          if (
            !repoGrant ||
            liveBuilds.length !== 1 ||
            liveBuilds[0]!.ref !== `live-${submission.data.id}` ||
            !game.githubPath
          )
            throw new Error('invalid_request');
          if (!(await liveWorkspaceReady(workspace, game.githubPath))) throw new Error('invalid_request');
          authorizedLive = true;
        }
        const daemon = reviewDaemonForGame(deps.db, game.id);
        if (!game.githubPath || (!daemon && !authorizedLive)) throw new Error('invalid_request');
        const track = await readTrack(
          authorizedLive ? workspace : await reviewCheckout(daemon!.checkoutPath, submission.data.ticket, daemon!.repo),
          game.githubPath,
          data.sha,
          submission.data.track,
        );
        if (
          track.category !== submission.data.category ||
          !track.phases.some((phase) => phase.id === submission.data.phase) ||
          phaseOwner(deps.db, game.id, track, submission.data.phase) !== submission.data.ticket
        )
          throw new Error('invalid_request');
        const seen = new Set<number>();
        let totalBytes = 0;
        const staged: { bytes: Buffer; mime: string; hash: `sha256:${string}` }[] = [];
        for (const attachment of attachments) {
          if (!attachment || typeof attachment !== 'object' || !('index' in attachment) || !('mime' in attachment))
            throw new Error('invalid_request');
          const { index, mime } = attachment;
          if (!Number.isInteger(index) || typeof index !== 'number' || index < 0 || seen.has(index))
            throw new Error('invalid_request');
          seen.add(index);
          const item = submission.data.media[index];
          if (
            !item ||
            (item.kind !== 'still' && item.kind !== 'clip' && item.kind !== 'audio') ||
            !(item.kind === 'clip'
              ? mime === 'video/mp4'
              : item.kind === 'audio'
                ? ['audio/wav', 'audio/mpeg', 'audio/ogg', 'audio/mp4'].includes(mime)
                : mime === 'image/png' || mime === 'image/jpeg')
          )
            throw new Error('invalid_request');
          const file = await openWithin(join(dir, `${filename.slice(0, -5)}.${index}.media`), dir, constants.O_RDONLY);
          try {
            const size = (await file.stat()).size;
            totalBytes += size;
            if (size <= 0 || totalBytes > Math.min(deps.config.blobPutMaxBytes, 64 * 1024 * 1024))
              throw new Error('invalid_request');
            const bytes = Buffer.alloc(size + 1);
            const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
            if (
              bytesRead !== size ||
              `sha256:${createHash('sha256').update(bytes.subarray(0, size)).digest('hex')}` !== item.ref
            )
              throw new Error('invalid_request');
            staged.push({ bytes: bytes.subarray(0, size), mime, hash: item.ref as `sha256:${string}` });
          } finally {
            await file.close();
          }
        }
        let round;
        if (staged.length === 0) {
          round = await submitRelayedReview(
            deps,
            data.slug,
            `${game.githubOwner}/${game.githubRepo}`,
            data.submission,
            undefined,
            undefined,
            authorizedLive,
            track,
          );
        } else {
          if (submission.data.category === 'gameplay' && submission.data.phase !== 'mock' && !authorizedLive)
            throw new Error('invalid_request');
          round = await withArtifactMutation(async () => {
            const overlay = {
              ...deps.blobStore,
              put: deps.blobStore.put.bind(deps.blobStore),
              delete: deps.blobStore.delete.bind(deps.blobStore),
              signedGet: deps.blobStore.signedGet.bind(deps.blobStore),
              head: async (hash: `sha256:${string}`) => {
                const existing = await deps.blobStore.head(hash);
                if (existing) return existing;
                const item = staged.find((candidate) => candidate.hash === hash);
                return item ? { hash, bytes: item.bytes.length, mime: item.mime } : null;
              },
              open: async (hash: `sha256:${string}`) => {
                const item = staged.find((candidate) => candidate.hash === hash);
                const metadata = await deps.blobStore.head(hash);
                if (metadata && item && metadata.mime !== item.mime) return null;
                const existing = await deps.blobStore.open(hash);
                if (existing) return existing;
                return item
                  ? { ref: { hash, bytes: item.bytes.length, mime: item.mime }, stream: Readable.from(item.bytes) }
                  : null;
              },
            };
            class Rollback extends Error {
              constructor(readonly result: { id: string; round: number }) {
                super('rollback');
              }
            }
            await submitRelayedReview(
              { ...deps, blobStore: overlay },
              data.slug,
              `${game.githubOwner}/${game.githubRepo}`,
              data.submission,
              new Set(staged.filter((item) => item.mime.startsWith('audio/')).map((item) => item.hash)),
              async (_deps, gameId, value, effort, audioVerified) => {
                try {
                  deps.db.transaction((tx) => {
                    throw new Rollback(submitRound(tx, gameId, value, effort, audioVerified));
                  });
                } catch (error) {
                  if (error instanceof Rollback) return error.result;
                  throw error;
                }
                throw new Error('review_preflight_failed');
              },
              authorizedLive,
              track,
            );
            for (const attachment of staged) await deps.blobStore.put(attachment.bytes, attachment.mime);
            return submitRelayedReview(
              deps,
              data.slug,
              `${game.githubOwner}/${game.githubRepo}`,
              data.submission,
              new Set(staged.filter((item) => item.mime.startsWith('audio/')).map((item) => item.hash)),
              async (_deps, gameId, value, effort, audioVerified) =>
                submitRound(deps.db, gameId, value, effort, audioVerified),
              authorizedLive,
              track,
            );
          });
        }
        result = { state: 'done', id: round.id, round: round.round };
        await response.writeFile(Buffer.from(JSON.stringify(result)));
        return;
      }
      if (data.kind !== undefined) throw new Error('invalid_request');
      const archive = await openWithin(join(dir, filename.replace(/\.json$/u, '.tgz')), dir, constants.O_RDONLY);
      let bytes: Buffer;
      try {
        const stat = await archive.stat();
        if (stat.size > ARCHIVE_LIMITS.compressedBytes) throw new Error('archive_too_large');
        bytes = Buffer.alloc(stat.size);
        let offset = 0;
        while (offset < bytes.length) {
          const read = await archive.read(bytes, offset, bytes.length - offset, offset);
          if (!read.bytesRead) throw new Error('archive_truncated');
          offset += read.bytesRead;
        }
      } finally {
        await archive.close();
      }
      const preview = await createPreview(deps, game.id, data.ticket, data.sha, bytes, data.branch);
      result = { state: 'done', gameId: preview.gameId, buildId: preview.buildId };
    } catch (error) {
      deps.log({ event: 'preview_relay_failed', reason: error instanceof Error ? error.name : 'Error' });
      const code =
        error instanceof HttpError &&
        [
          'planner_ticket_limit',
          'planner_child_conflict',
          'planner_decision_conflict',
          'invalid_planner_child',
          'invalid_planner_base',
        ].includes(error.code)
          ? error.code
          : error instanceof AdmissionRefused
            ? error.body.error
            : 'preview upload refused';
      result = { state: 'failed', error: code };
    }
    const output = Buffer.from(JSON.stringify(result));
    await response.writeFile(output);
  } catch {
    // A workspace can disappear or change while it is being scanned.
  } finally {
    await response?.close();
    await request?.close();
    await directory?.close();
  }
}

async function refreshCredential(
  workspace: string,
  secret: string,
  repo: string,
  ticket: string,
  game: string,
  grant: string,
  verifyTicket: PreviewTicketVerifier,
  requireGameLabel: boolean,
): Promise<void> {
  const context = join(workspace, '.gm', 'context');
  if ((await realpath(context).catch(() => '')) !== context) return;
  let directory;
  try {
    directory = await open(context, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    if ((await readlink(`/proc/self/fd/${directory.fd}`)) !== context) return;
    const current = await openWithin(join(context, 'preview.json'), context, constants.O_RDONLY)
      .then(async (handle) => {
        try {
          if ((await handle.stat()).size > 8192) return null;
          const buffer = Buffer.alloc(8193);
          const read = await handle.read(buffer, 0, buffer.length, 0);
          if (read.bytesRead > 8192) return null;
          return JSON.parse(buffer.subarray(0, read.bytesRead).toString('utf8')) as { token?: string };
        } finally {
          await handle.close();
        }
      })
      .catch(() => null);
    const claims = typeof current?.token === 'string' ? verifyPreviewToken(current.token, secret) : null;
    if (
      claims &&
      claims.ticket === ticket &&
      claims.game === game &&
      claims.grant === grant &&
      claims.expires > Date.now() + 30 * 60 * 1000
    )
      return;
    if ((refreshAttempts.get(workspace) ?? 0) > Date.now() - 60_000) return;
    if (refreshAttempts.size >= 5000) refreshAttempts.clear();
    refreshAttempts.set(workspace, Date.now());
    if (!(await verifyTicket(repo, ticket, game, requireGameLabel))) return;
    const path = `/proc/self/fd/${directory.fd}`;
    const temporary = `${path}/.preview-${randomUUID()}.tmp`;
    const handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await handle.writeFile(JSON.stringify({ token: mintPreviewToken(secret, ticket, grant, game) }));
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, `${path}/preview.json`);
    } finally {
      await rm(temporary, { force: true });
    }
  } catch {
    /* Workspaces may disappear while they are being refreshed. */
  } finally {
    await directory?.close();
  }
}

async function scanDirectory(
  deps: AppDeps,
  home: string,
  root: string,
  depth: number,
  verifyTicket: PreviewTicketVerifier,
  daemon?: { slug: string; repo: string },
): Promise<void> {
  if (depth > 6) return;
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name === '.git') continue;
    const path = join(root, entry.name);
    if (entry.name === '.gm') {
      if (daemon) {
        const hash = createHash('sha256').update(root).digest('hex');
        const secretRoot = join(home, '.config/ogm/daemons', daemon.slug);
        const grant = await readFile(join(secretRoot, 'preview-grants', `${hash}.json`), 'utf8')
          .then(
            (text) => JSON.parse(text) as { ticket: string; game: string; grant: string },
            () => null,
          )
          .catch(() => null);
        const secret = await readFile(join(secretRoot, 'hook-secret'), 'utf8').catch(() => '');
        if (grant && secret.trim())
          await refreshCredential(
            root,
            secret.trim(),
            daemon.repo,
            grant.ticket,
            grant.game,
            grant.grant,
            verifyTicket,
            false,
          );
      }
      const directory = join(path, 'preview');
      const actual = await realpath(directory).catch(() => '');
      if (actual !== directory) continue;
      const files = await readdir(directory).catch(() => []);
      for (const file of files)
        if (requestName.test(file)) await processRequest(deps, home, directory, file, verifyTicket);
    } else await scanDirectory(deps, home, path, depth + 1, verifyTicket, daemon);
  }
}

async function scanRepositoryGrants(deps: AppDeps, home: string, verifyTicket: PreviewTicketVerifier): Promise<void> {
  const games = await deps.db
    .select({ owner: schema.games.githubOwner, repo: schema.games.githubRepo })
    .from(schema.games);
  const repositories = new Set(
    games.filter((game) => game.owner && game.repo).map((game) => `${game.owner}/${game.repo}`.toLowerCase()),
  );
  for (const repo of repositories) {
    const hash = createHash('sha256').update(repo).digest('hex');
    const root = join(home, '.config/ogm/preview-repos', hash);
    const secret = await readFile(join(root, 'secret'), 'utf8').catch(() => '');
    if (!secret.trim()) continue;
    const files = await readdir(join(root, 'grants')).catch(() => []);
    for (const file of files) {
      if (!/^[0-9a-f]{64}\.json$/u.test(file)) continue;
      const data = await readFile(join(root, 'grants', file), 'utf8')
        .then(
          (text) => JSON.parse(text) as Partial<RepoGrant>,
          () => null,
        )
        .catch(() => null);
      if (
        !data ||
        data.repo !== repo ||
        typeof data.workspace !== 'string' ||
        typeof data.ticket !== 'string' ||
        typeof data.grant !== 'string' ||
        typeof data.game !== 'string' ||
        createHash('sha256').update(data.workspace).digest('hex') + '.json' !== file
      )
        continue;
      await refreshCredential(
        data.workspace,
        secret.trim(),
        repo,
        data.ticket,
        data.game,
        data.grant,
        verifyTicket,
        true,
      );
      const dir = join(data.workspace, '.gm', 'preview');
      if ((await realpath(dir).catch(() => '')) !== dir) continue;
      const entries = await readdir(dir).catch(() => []);
      const grant: RepoGrant = {
        repo,
        workspace: data.workspace,
        ticket: data.ticket,
        game: data.game,
        grant: data.grant,
        secret: secret.trim(),
      };
      for (const entry of entries)
        if (requestName.test(entry)) await processRequest(deps, home, dir, entry, verifyTicket, grant);
    }
  }
}

export async function scanPreviewRelay(
  deps: AppDeps,
  home = homedir(),
  verifyTicket: PreviewTicketVerifier = async () => false,
): Promise<void> {
  await scanRepositoryGrants(deps, home, verifyTicket);
  const rows = await deps.db
    .select({ slug: schema.gameDaemons.slug, repo: schema.gameDaemons.repo })
    .from(schema.gameDaemons);
  for (const { slug, repo } of rows) {
    if (!/^[A-Za-z0-9_-]+$/u.test(slug)) continue;
    const root = join(home, '.local/share/ogm/daemons', slug, 'workspaces');
    await scanDirectory(deps, home, root, 0, verifyTicket, { slug, repo });
  }
}

export function startPreviewRelay(deps: AppDeps, verifyTicket: PreviewTicketVerifier): void {
  let running = false;
  const scan = async () => {
    if (running) return;
    running = true;
    try {
      await scanPreviewRelay(deps, homedir(), verifyTicket);
    } catch (error) {
      deps.log({ event: 'preview_relay_scan_failed', reason: error instanceof Error ? error.message : 'Error' });
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void scan(), 2000);
  timer.unref();
  void scan();
}
