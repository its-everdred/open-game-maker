import { AiurHttpError, type ExecutorThreadMessage } from '@ogm/aiur-client';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { schema } from '@ogm/db';

import { HttpError } from '../app/errors.js';
import { readBoundedBody } from '../app/read-body.js';
import type { ApiBindings, AppDeps } from '../app/types.js';
import { parseBody } from '../app/validate.js';
import { owner } from '../commands/core.js';
import { findGameForFamily } from '../games/games.js';
import { requirePrincipal } from '../app/principal.js';

// The creator's conversation with the Executor (#854), on the core daemon's thread API (aiur-team/aiur#8034). Only the
// instance owner reaches it, as with the core Commands: the Executor is the owner's operator, not any creator's.
// The browser never calls aiur; attachments come back through this API by their opaque aiur id.
export const prefix = '/api/v1';

const PAGE_LIMIT = 100;
export const MAX_THREAD_UPLOAD_BYTES = 50 * 1024 * 1024;
const ATTACHMENT_ID = /^[A-Za-z0-9_-]{1,128}$/u;

const SendBody = z
  .object({
    text: z.string().trim().min(1).max(16000),
    client_request_id: z.string().regex(/^[A-Za-z0-9:_-]{1,100}$/u),
    // Where the creator was when they asked; the API names the game and its build from its own records.
    context: z
      .object({
        game_id: z.string().min(1).max(100).optional(),
        screen: z.string().min(1).max(300).optional(),
      })
      .strict()
      .optional(),
    attachments: z
      .array(
        z
          .object({
            upload_id: z.string().min(1).max(128),
            kind: z.enum(['image', 'audio', 'video', 'screenshot']),
            mime_type: z.string().min(1).max(100),
          })
          .strict(),
      )
      .max(6)
      .optional(),
  })
  .strict();

type ThreadMedia = { id: string; kind: 'image' | 'audio' | 'video'; mime: string | null; url: string };

export type ThreadMessage = Omit<ExecutorThreadMessage, 'attachments'> & { attachments: ThreadMedia[] };

function mediaKind(kind: string | null | undefined, mime: string | null | undefined): ThreadMedia['kind'] | null {
  const family = (mime ?? '').split('/')[0];
  if (kind === 'image' || kind === 'screenshot' || family === 'image') return 'image';
  if (kind === 'audio' || family === 'audio') return 'audio';
  if (kind === 'video' || family === 'video') return 'video';
  return null;
}

// aiur's media carry an opaque id; the app fetches each through this API. Anything else (a URL locator) is dropped:
// an operator message never needs one, and an Executor reply's files are always attachments.
function present(message: ExecutorThreadMessage): ThreadMessage {
  const attachments = message.attachments.flatMap((media): ThreadMedia[] => {
    const id = media.attachment_id ?? media.locator?.attachment_id;
    const kind = mediaKind(media.kind, media.mime_type);
    if (!id || !ATTACHMENT_ID.test(id) || !kind) return [];
    return [
      {
        id,
        kind,
        mime: media.mime_type ?? null,
        url: `/api/v1/me/executor/thread/attachments/${encodeURIComponent(id)}`,
      },
    ];
  });
  return { ...message, attachments };
}

function contextLine(deps: AppDeps, familyId: string, context: z.output<typeof SendBody>['context']): string | null {
  if (!context) return null;
  const parts: string[] = [];
  if (context.game_id) {
    let game: ReturnType<typeof findGameForFamily> | undefined;
    try {
      game = findGameForFamily(deps.db, context.game_id, familyId);
    } catch {
      game = undefined;
    }
    if (game) {
      parts.push(`game ${game.title}${game.slug ? ` (${game.slug})` : ''}`);
      const main = deps.db
        .select({ build: schema.branches.latestBuildId })
        .from(schema.branches)
        .where(and(eq(schema.branches.gameId, game.id), eq(schema.branches.name, 'main')))
        .get();
      if (main?.build) parts.push(`build ${main.build}`);
    }
  }
  if (context.screen) parts.push(`screen ${context.screen}`);
  return parts.length === 0 ? null : `[Sent from Open Game Maker: ${parts.join(', ')}]`;
}

async function call<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AiurHttpError && error.status === 409) throw new HttpError(409, 'executor_unavailable');
    if (error instanceof AiurHttpError && error.status === 413) throw new HttpError(413, 'attachment_too_large');
    if (error instanceof AiurHttpError && error.status === 404) throw new HttpError(404, 'not_found');
    throw new HttpError(502, 'core_daemon_unavailable');
  }
}

export default new Hono<ApiBindings>()
  .get('/me/executor/thread', async (c) => {
    const { client } = owner(c);
    return c.json(await call(() => client.executorThread(AbortSignal.timeout(5000))));
  })
  .get('/me/executor/thread/messages', async (c) => {
    const { client } = owner(c);
    const raw = c.req.query('after') ?? '0';
    if (!/^[0-9]{1,15}$/u.test(raw)) throw new HttpError(400, 'invalid_request');
    const page = await call(() => client.executorThreadMessages(Number(raw), PAGE_LIMIT, AbortSignal.timeout(10000)));
    return c.json({
      messages: page.messages.map(present),
      next_after: page.next_after,
      queued: page.queued.map(present),
    });
  })
  .post('/me/executor/thread/messages', async (c) => {
    const { client } = owner(c);
    const body = await parseBody(c, SendBody);
    const familyId = requirePrincipal(c, ['user']).familyId;
    const line = contextLine(c.get('deps'), familyId, body.context);
    const message = await call(() =>
      client.sendExecutorThreadMessage(
        {
          text: line ? `${body.text}\n\n${line}` : body.text,
          client_request_id: `ogm:${body.client_request_id}`,
          ...(body.attachments?.length ? { attachments: body.attachments } : {}),
        },
        AbortSignal.timeout(15000),
      ),
    );
    return c.json({ message: present(message) }, 202);
  })
  .post('/me/executor/thread/uploads', async (c) => {
    const { client } = owner(c);
    const type = (c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!/^(image|audio|video)\/[a-z0-9.+-]{1,60}$/u.test(type) || type === 'image/svg+xml')
      throw new HttpError(415, 'unsupported_media_type');
    const length = c.req.header('content-length');
    if (length !== undefined && (!/^[0-9]+$/u.test(length) || Number(length) > MAX_THREAD_UPLOAD_BYTES))
      throw new HttpError(413, 'attachment_too_large');
    const bytes = await readBoundedBody(c.req.raw, MAX_THREAD_UPLOAD_BYTES, 'attachment_too_large');
    if (bytes.byteLength === 0) throw new HttpError(400, 'empty_attachment');
    let name = 'attachment';
    try {
      name =
        decodeURIComponent(c.req.header('x-file-name') ?? '')
          .replace(/[^\w. -]/gu, '')
          .slice(0, 100) || name;
    } catch {
      // A malformed name keeps the default.
    }
    const upload = await call(() =>
      client.uploadExecutorThreadFile(new Blob([bytes.slice()], { type }), name, AbortSignal.timeout(60000)),
    );
    return c.json(upload, 201);
  })
  .get('/me/executor/thread/attachments/:attachmentId', async (c) => {
    const { client } = owner(c);
    const id = c.req.param('attachmentId');
    if (!ATTACHMENT_ID.test(id)) throw new HttpError(400, 'invalid_request');
    const file = await call(() => client.executorThreadAttachment(id, AbortSignal.timeout(60000)));
    // Served from the app's own origin, so only media types ever render; anything else could run as a page.
    const mime = file.mime.split(';')[0]!.trim().toLowerCase();
    if (!/^(image|audio|video)\/[a-z0-9.+-]{1,60}$/u.test(mime) || mime === 'image/svg+xml') {
      await file.body.cancel();
      throw new HttpError(502, 'unsupported_media_type');
    }
    return new Response(file.body, {
      headers: {
        'content-type': mime,
        'cache-control': 'private, max-age=3600',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
      },
    });
  });
