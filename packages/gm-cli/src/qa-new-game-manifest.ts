import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { z } from 'zod';

const GameId = z.string().regex(/^g_[A-Za-z0-9_-]+$/u);
const Manifest = z
  .object({
    version: z.literal(1),
    repo: z.string().regex(/^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/u),
    run: z.string().regex(/^[a-z0-9-]{1,30}$/u),
    baseline: z.array(GameId).max(1_000),
    games: z
      .array(
        z
          .object({
            id: GameId,
            status: z.number().int().min(100).max(599),
            ok: z.boolean(),
            cleaned: z.boolean(),
            deleteReady: z.boolean().default(false),
          })
          .strict(),
      )
      .max(10),
    complete: z.boolean(),
  })
  .strict()
  .refine(
    (state) =>
      new Set(state.baseline).size === state.baseline.length &&
      new Set(state.games.map((game) => game.id)).size === state.games.length,
  );

export type QaManifest = z.infer<typeof Manifest>;

export async function readQaManifest(path: string, repo: string): Promise<QaManifest | null> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const result = Manifest.safeParse(JSON.parse(text) as unknown);
  if (!result.success) throw new Error('invalid QA recovery manifest');
  if (result.data.repo !== repo) throw new Error('QA recovery manifest names a different repository');
  return result.data;
}

export async function saveQaManifest(path: string, state: QaManifest): Promise<void> {
  const value = Manifest.parse(state);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Unknown additions may belong to another QA session; never infer ownership from timing alone. */
export function unknownQaGames(state: QaManifest, current: readonly string[]): string[] {
  const known = new Set([...state.baseline, ...state.games.map((game) => game.id)]);
  return current.filter((id) => !known.has(id));
}
