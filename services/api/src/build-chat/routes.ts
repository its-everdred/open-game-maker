import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';

import { ChatPostBody, ChatSinceQuery, type ChatMessagesPage } from '@ogm/contracts';
import { HttpError } from '../app/errors.js';
import { requirePrincipal } from '../app/principal.js';
import { readBoundedBody } from '../app/read-body.js';
import type { ChatJob } from '../app/registry.js';
import type { ApiBindings, AppDeps } from '../app/types.js';
import { parseBody, parseQuery } from '../app/validate.js';
import { authorizedChatJob } from './authorization.js';
import { createMirror, type Mirror } from './aiur-mirror.js';
import {
  attachmentLimit,
  attachmentType,
  claimAttachments,
  displayName,
  messageAttachments,
  storeAttachment,
  toChatAttachment,
  writeAttachmentInbox,
} from './attachments.js';
import { mediaSigner } from './media.js';
import { loadOutboxHandlers } from './outbox-handlers.js';
import { createOutboxRelay } from './outbox-relay.js';
import { createProgressPoller } from './progress-poller.js';
import {
  insertChatRow,
  listSince,
  newMessageId,
  shownInChat,
  toMessage,
  type ChatRow,
  type MediaSigner,
} from './store.js';
import { createChatHub, formatChatFrame, type ChatHub } from './stream.js';
import { getNarrationRenderer } from '../narration/render.js';

export const prefix = '/api/v1/jobs';

const POSTS_PER_MINUTE = 30;
const UPLOADS_PER_MINUTE = 20;

type ChatRuntime = {
  hub: ChatHub;
  mirror: Mirror;
  sign: MediaSigner;
  posts: Map<string, number[]>;
  uploads: Map<string, number[]>;
};
const runtimes = new WeakMap<AppDeps, ChatRuntime>();

export function getChatRuntime(deps: AppDeps): ChatRuntime {
  const runtime = runtimes.get(deps);
  if (!runtime) throw new Error('build chat context was not set up');
  return runtime;
}

// The relay and poller start only when configured: a workspaces root for the relay, a period for the poller.
export function setup(deps: AppDeps): void {
  if (runtimes.has(deps)) return;
  const hub = createChatHub();
  const sign = mediaSigner(deps.blobStore);
  const publish = (jobId: string) => hub.publish(jobId);
  const jobs = () => deps.registry.chatJobs;
  const clientFor = () => deps.registry.aiurClientFor;
  const mirror = createMirror({
    sqlite: deps.sqlite,
    jobs,
    clientFor,
    sign,
    blobStore: deps.blobStore,
    publish,
    log: deps.log,
  });
  runtimes.set(deps, { hub, mirror, sign, posts: new Map(), uploads: new Map() });

  const flush = (jobId: string) =>
    mirror.flushPending(jobId).catch((error: unknown) => {
      deps.log({ event: 'chat-mirror-error', jobId, error: (error as Error).name });
    });
  deps.events.on('job.changed', ({ jobId }) => void flush(jobId));

  if (deps.config.chatPollMs !== undefined) {
    createProgressPoller({ sqlite: deps.sqlite, jobs, clientFor, publish, log: deps.log, flushPending: flush }).start(
      deps.config.chatPollMs,
    );
  }

  const root = deps.config.builderWorkspacesRoot;
  if (root === undefined) {
    deps.log({ event: 'chat-relay-disabled', missing: 'OGM_BUILDER_WORKSPACES_ROOT' });
    return;
  }
  void loadOutboxHandlers()
    .then((handlers) => {
      const narration = getNarrationRenderer(deps);
      createOutboxRelay({
        root,
        sqlite: deps.sqlite,
        handlers,
        jobs,
        log: deps.log,
        context: (jobId, workspaceRoot) => ({
          jobId,
          workspaceRoot,
          db: deps.db,
          sqlite: deps.sqlite,
          blobStore: deps.blobStore,
          ...(narration ? { renderNarration: (lines) => narration.renderLines(lines) } : {}),
          publish,
          notify: (trigger) => deps.events.emit('notify', trigger),
          log: deps.log,
        }),
      }).start();
    })
    .catch((error: unknown) => deps.log({ event: 'outbox-relay-error', stack: (error as Error).stack }));
}

// `?since=` wins; otherwise a reconnecting EventSource's Last-Event-ID.
function sinceOf(c: Context<ApiBindings>): number {
  const { since } = parseQuery(c, ChatSinceQuery);
  if (c.req.query('since') !== undefined) return since;
  const lastId = c.req.header('last-event-id');
  return lastId !== undefined && /^[0-9]{1,15}$/.test(lastId) ? Number(lastId) : since;
}

function allow(window: Map<string, number[]>, key: string, limit: number, now = Date.now()): boolean {
  const recent = (window.get(key) ?? []).filter((at) => now - at < 60_000);
  if (recent.length >= limit) {
    window.set(key, recent);
    return false;
  }
  recent.push(now);
  window.set(key, recent);
  return true;
}

// Creator rows carry their attachments; other rows never do, so they skip the lookup.
function messageOf(deps: AppDeps, row: ChatRow, sign: MediaSigner) {
  const attachments = row.actor === 'creator' ? messageAttachments(deps.sqlite, row.id).map(toChatAttachment) : [];
  return toMessage(row, sign, attachments);
}

function chatStream(c: Context<ApiBindings>, job: ChatJob, since: number) {
  const deps = c.get('deps');
  const runtime = getChatRuntime(deps);
  if (!runtime.hub.canSubscribe(job.jobId)) throw new HttpError(503, 'too_many_streams');

  return streamSSE(c, async (stream) => {
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let cursor = since;
    let chain = Promise.resolve();
    // Serial: each pass drains every row past the cursor, so wake-ups never reorder or repeat rows.
    const pump = () => {
      chain = chain
        .then(async () => {
          for (;;) {
            const rows = listSince(deps.sqlite, job.jobId, cursor);
            if (rows.length === 0) return;
            for (const row of rows) {
              if (shownInChat(row)) {
                await stream.write(formatChatFrame(row.seq, await messageOf(deps, row, runtime.sign)));
              }
              cursor = row.seq;
            }
          }
        })
        .catch(finish);
    };

    const unsubscribe = runtime.hub.subscribe(job.jobId, pump);
    stream.onAbort(finish);
    const keepalive = setInterval(() => {
      void stream.write(': ping\n\n').catch(finish);
    }, 25_000);
    keepalive.unref();
    pump();

    try {
      await finished;
    } finally {
      clearInterval(keepalive);
      unsubscribe();
    }
  });
}

export default new Hono<ApiBindings>()
  .get('/:jobId/chat', async (c) => {
    const job = await authorizedChatJob(c, 'game.edit');
    return chatStream(c, job, sinceOf(c));
  })
  .get('/:jobId/chat/messages', async (c) => {
    const job = await authorizedChatJob(c, 'game.edit');
    const since = sinceOf(c);
    const { sign } = getChatRuntime(c.get('deps'));
    const rows = listSince(c.get('deps').sqlite, job.jobId, since);
    const page: ChatMessagesPage = {
      messages: await Promise.all(rows.filter(shownInChat).map((row) => messageOf(c.get('deps'), row, sign))),
      last_seq: rows.at(-1)?.seq ?? since,
    };
    return c.json(page);
  })
  .post('/:jobId/chat/attachments', async (c) => {
    const job = await authorizedChatJob(c, 'job.create', true);
    const deps = c.get('deps');
    const runtime = getChatRuntime(deps);
    if (!allow(runtime.uploads, job.jobId, UPLOADS_PER_MINUTE)) throw new HttpError(429, 'rate_limited');
    const type = attachmentType(c.req.header('content-type'));
    const limit = attachmentLimit(type);
    const length = c.req.header('content-length');
    if (length !== undefined && (!/^[0-9]+$/.test(length) || Number(length) > limit)) {
      throw new HttpError(413, 'attachment_too_large');
    }
    const bytes = await readBoundedBody(c.req.raw, limit, 'attachment_too_large');
    if (bytes.byteLength === 0) throw new HttpError(400, 'empty_attachment');
    const row = await storeAttachment(deps.sqlite, deps.blobStore, {
      jobId: job.jobId,
      creatorId: requirePrincipal(c, ['user']).userId,
      type,
      name: displayName(c.req.header('x-file-name'), type === 'image' ? 'image' : 'file'),
      bytes,
    });
    return c.json(toChatAttachment(row), 201);
  })
  .post('/:jobId/chat', async (c) => {
    const job = await authorizedChatJob(c, 'job.create', true);
    const body = await parseBody(c, ChatPostBody);
    const deps = c.get('deps');
    const runtime = getChatRuntime(deps);
    if (!allow(runtime.posts, job.jobId, POSTS_PER_MINUTE)) throw new HttpError(429, 'rate_limited');

    const { row, attachments } = deps.sqlite.transaction(() => {
      const id = newMessageId();
      const attached =
        body.attachments === undefined
          ? []
          : claimAttachments(deps.sqlite, {
              ids: body.attachments,
              jobId: job.jobId,
              creatorId: requirePrincipal(c, ['user']).userId,
              messageId: id,
            });
      const inserted = insertChatRow(deps.sqlite, {
        id,
        jobId: job.jobId,
        actor: 'creator',
        kind: 'text',
        ...(body.text === undefined ? {} : { text: body.text }),
        mirrorState: 'pending',
        ...(job.aiur ? { aiur: { ticket: job.aiur.ticket } } : {}),
      });
      return { row: inserted.row!, attachments: attached };
    })();
    runtime.hub.publish(job.jobId);
    // The inbox copy runs before the mirror so the files are in place when the worker reads the message naming them.
    const delivered =
      attachments.length === 0
        ? Promise.resolve()
        : writeAttachmentInbox(deps, job.jobId, attachments).then(
            () => undefined,
            (error: unknown) => {
              deps.log({ event: 'attachment-inbox-error', jobId: job.jobId, error: (error as Error).name });
            },
          );
    void delivered
      .then(() => runtime.mirror.mirror(row.id))
      .catch((error: unknown) => {
        deps.log({ event: 'chat-mirror-error', jobId: job.jobId, error: (error as Error).name });
      });
    return c.json(await toMessage(row, runtime.sign, attachments.map(toChatAttachment)), 201);
  });
