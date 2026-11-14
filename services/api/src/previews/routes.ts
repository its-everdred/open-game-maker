import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Hono } from 'hono';
import { z } from 'zod';

import { HttpError } from '../app/errors.js';
import { parseBody } from '../app/validate.js';
import type { ApiBindings } from '../app/types.js';
import { authorizedGame } from '../games/authorize.js';
import { answerPreview, listEditorPreviews, listPreviewHistory, listPreviews, previewDirectory } from './store.js';

export const prefix = '/api/v1';

const Verdict = z
  .object({
    buildId: z.string().regex(/^preview-[0-9a-f-]{36}$/u),
    verdict: z.enum(['looks right', 'needs work']),
    note: z.string().max(3900).optional(),
  })
  .strict();

export default new Hono<ApiBindings>()
  .get('/games/:gameId/editor/preview-history', async (c) => {
    const game = authorizedGame(c, 'game.edit');
    return c.json({ previews: await listPreviewHistory(c.get('deps'), game.id) });
  })
  .get('/games/:gameId/editor/previews', async (c) => {
    const game = authorizedGame(c, 'game.edit');
    return c.json({ previews: await listEditorPreviews(c.get('deps'), game.id) });
  })
  .get('/games/:gameId/previews', async (c) => {
    const game = authorizedGame(c, 'game.edit');
    const deps = c.get('deps');
    const previews = await listPreviews(deps, game.id);
    const repo = game.githubOwner && game.githubRepo ? { owner: game.githubOwner, name: game.githubRepo } : undefined;
    const named = await Promise.all(
      previews.map(async (preview) => {
        const title = await deps.registry.workerTitle?.(preview.ticket, repo).catch(() => '');
        return title ? { ...preview, title } : preview;
      }),
    );
    return c.json({ previews: named });
  })
  .get('/games/:gameId/previews/:ticket/design', async (c) => {
    const game = authorizedGame(c, 'game.edit');
    const deps = c.get('deps');
    const preview = (await listEditorPreviews(deps, game.id)).find((item) => item.ticket === c.req.param('ticket'));
    if (!preview || preview.buildId !== c.req.query('buildId')) throw new HttpError(404, 'preview_not_found');
    const doc = JSON.parse(
      await readFile(join(previewDirectory(deps, game.id, preview.buildId), 'design', 'design.json'), 'utf8'),
    ) as unknown;
    return c.json({ rev: 0, doc });
  })
  .post('/games/:gameId/previews/:ticket/answer', async (c) => {
    const game = authorizedGame(c, 'game.edit');
    const { buildId, verdict, note } = await parseBody(c, Verdict);
    const ticket = c.req.param('ticket');
    if (!/^[1-9]\d{0,15}$/u.test(ticket)) throw new HttpError(400, 'invalid_ticket');
    const message = `Preview review of ${buildId}: ${verdict}.${note ? `\n${note}` : ''}`;
    const answered = await answerPreview(c.get('deps'), game.id, ticket, buildId, message, verdict, note);
    if (!answered) throw new HttpError(409, 'preview_changed');
    return c.json({ status: 'answered' });
  });
