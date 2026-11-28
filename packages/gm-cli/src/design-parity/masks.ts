import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const rectangle = z
  .object({
    reason: z.enum(['live-game-canvas', 'timestamp', 'avatar']),
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();
const registry = z.record(z.string().min(1), z.array(rectangle));

/** The registry is a reviewed file, never a command-line mask. */
export async function readMasks(file: string, screen: string) {
  const entries = registry.parse(JSON.parse(await readFile(file, 'utf8')));
  if (!Object.hasOwn(entries, screen)) throw new Error(`No reviewed mask entry for ${screen}`);
  return entries[screen]!;
}
