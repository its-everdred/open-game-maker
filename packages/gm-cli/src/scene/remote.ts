import { readFile } from 'node:fs/promises';

import { SceneConflictSchema, SceneHeadSchema, SceneRevisionSchema, type SceneDoc } from '@ogm/contracts';
import { z } from 'zod';

import { CommandError, type GmContext } from '../command.js';

const StoreSchema = z.object({ head: SceneHeadSchema, log: z.array(SceneRevisionSchema) });
export type RemoteStore = z.infer<typeof StoreSchema>;
const PushSchema = z.union([
  z.object({
    ok: z.literal(true),
    head: SceneHeadSchema,
    revision: SceneRevisionSchema.nullable(),
    rebased: z.boolean(),
  }),
  z.object({ ok: z.literal(false), conflicts: z.array(SceneConflictSchema) }),
]);
export type RemotePush = z.infer<typeof PushSchema>;

/**
 * The shared scene store behind `gm scene pull`/`push` (#1209): the API holds the head and log the map maker saves
 * Kevin's edits to. Null without the internal API (a local run), where the game folder's files are the store.
 */
export function sceneRemote(ctx: GmContext, ticket: string, scene: string) {
  const api = ctx.blobApi;
  if (!api) return null;
  const url = new URL(
    `/internal/jobs/by-ticket/${encodeURIComponent(ticket)}/scenes/${encodeURIComponent(scene)}`,
    api.url,
  );
  async function call(suffix: '' | '/seed', init: RequestInit = {}): Promise<Response> {
    try {
      const secret = (await readFile(api!.secretFile, 'utf8')).trim();
      if (!secret) throw new Error('missing credential');
      return await fetch(`${url.href}${suffix}`, {
        ...init,
        headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new CommandError('the shared scene store is unavailable; retry');
    }
  }
  async function parsed<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
    const body: unknown = await response.json().catch(() => undefined);
    const result = schema.safeParse(body);
    if (!response.ok || !result.success) {
      const message = (body as { error?: { message?: string } } | undefined)?.error?.message;
      throw new CommandError(`the shared scene store refused the request${message ? `: ${message}` : ''}`);
    }
    return result.data;
  }
  return {
    /** The store, or undefined when neither the API nor the game's main checkout has this scene yet. */
    async get(): Promise<RemoteStore | undefined> {
      const response = await call('');
      if (response.status === 404) return undefined;
      return parsed(response, StoreSchema);
    },
    /** Start the store from this checkout's copy; an existing store wins and comes back unchanged. */
    async seed(store: RemoteStore): Promise<RemoteStore> {
      return parsed(await call('/seed', { method: 'POST', body: JSON.stringify(store) }), StoreSchema);
    },
    async push(input: { baseRev: number; doc: SceneDoc; label: string }): Promise<RemotePush> {
      return parsed(await call('', { method: 'POST', body: JSON.stringify(input) }), PushSchema);
    },
  };
}
