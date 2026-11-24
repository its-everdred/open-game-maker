import { z } from 'zod';

/** What failed. Shell-side kinds come from the app; the game_* kinds are relayed from the game frame. */
export const CrashKind = z.enum([
  'try_again',
  'bridge_timeout',
  'game_error',
  'game_rejection',
  'csp_violation',
  'asset_load_failed',
  'chunk_load_failed',
  'webgl_context_lost',
  'save_restore_failed',
  'shell_error',
]);
export type CrashKind = z.infer<typeof CrashKind>;

/** Where the player was: before ready, before the first frame, playing, after load.done. */
export const PlayStep = z.enum(['loading', 'title', 'play', 'in-world']);
export type PlayStep = z.infer<typeof PlayStep>;

const at = z.iso.datetime();
const short = (max: number) => z.string().max(max);

const common = {
  at,
  sessionId: z.uuid(),
  origin: short(200),
  appVersion: short(64),
  device: short(200),
  gameId: short(128).optional(),
  buildId: short(128).optional(),
};

export const ClientEvent = z.discriminatedUnion('kind', [
  z.strictObject({ ...common, kind: z.literal('app_open'), resumed: z.boolean() }),
  z.strictObject({ ...common, kind: z.literal('session_end'), reason: z.enum(['pagehide', 'hidden']) }),
  z.strictObject({ ...common, kind: z.literal('first_frame') }),
  z.strictObject({ ...common, kind: z.literal('in_world') }),
  z.strictObject({
    ...common,
    kind: z.literal('crash'),
    crash: CrashKind,
    step: PlayStep.optional(),
    message: short(500),
    stack: short(4000).optional(),
    breadcrumbs: z.array(short(120)).max(20),
  }),
]);
export type ClientEvent = z.infer<typeof ClientEvent>;

export const ClientEventBatch = z.strictObject({ events: z.array(ClientEvent).min(1).max(20) });
export type ClientEventBatch = z.infer<typeof ClientEventBatch>;

/** A non-fatal failure inside the game frame, relayed to the shell over the bridge as `fault`. */
export const GameFault = z.looseObject({
  kind: z.enum(['error', 'rejection', 'csp', 'asset', 'webgl']),
  message: short(500),
  stack: short(4000).optional(),
});
export type GameFault = z.infer<typeof GameFault>;
