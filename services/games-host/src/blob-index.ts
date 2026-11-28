import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { cachePlanSchema } from '@ogm/contracts';

type BlobIndex = { names: ReadonlySet<string>; legacy: boolean; source?: { gameId: string; buildId: string } };
type Entry = BlobIndex & { fingerprint: string };
const fallback: BlobIndex = { names: new Set(), legacy: true };
const cache = new Map<string, Entry>();
const pending = new Map<string, { fingerprint: string; result: Promise<BlobIndex> }>();
const MAX_PLANS = 4096;

/** Parsed plan indexes are cached by file identity; release authorization is checked separately. */
export async function artifactBlobIndex(directory: string, gameId: string, buildId: string): Promise<BlobIndex> {
  const file = join(directory, 'assets/cache-plan.json');
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return fallback;
  const fingerprint = `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
  const existing = cache.get(file);
  if (existing?.fingerprint === fingerprint) return existing;
  const inFlight = pending.get(file);
  if (inFlight?.fingerprint === fingerprint) return inFlight.result;
  const result = load(file, fingerprint, directory, gameId, buildId);
  pending.set(file, { fingerprint, result });
  try {
    return await result;
  } finally {
    if (pending.get(file)?.result === result) pending.delete(file);
  }
}

async function load(
  file: string,
  fingerprint: string,
  directory: string,
  gameId: string,
  buildId: string,
): Promise<BlobIndex> {
  const raw = await readFile(file, 'utf8').catch(() => null);
  if (raw === null) return fallback;
  const after = await stat(file).catch(() => null);
  if (!after || `${after.dev}:${after.ino}:${after.size}:${after.mtimeMs}:${after.ctimeMs}` !== fingerprint)
    return fallback;
  try {
    const parsed = cachePlanSchema.safeParse(JSON.parse(raw) as unknown);
    if (!parsed.success) return fallback;
    if (parsed.data.gameId !== gameId || parsed.data.buildId !== buildId) {
      // Fork artifacts are directory symlinks to their source build. Accept only
      // the actual target inside the same games root, not arbitrary plan IDs.
      const target = await realpath(directory).catch(() => '');
      const root = await realpath(dirname(dirname(directory))).catch(() => '');
      if (
        !target ||
        dirname(dirname(target)) !== root ||
        basename(dirname(target)) !== parsed.data.gameId ||
        basename(target) !== parsed.data.buildId
      )
        return fallback;
    }
    const names = new Set(
      parsed.data.entries.flatMap((entry) => {
        const name = entry.url.startsWith('/a/') ? entry.url.slice(3) : '';
        return /^[0-9a-f]{64}\.[a-z0-9]{1,12}$/u.test(name) && name.slice(0, 64) === entry.sha256 ? [name] : [];
      }),
    );
    const legacy = parsed.data.entries.some((entry) => entry.url.startsWith('/a/') || entry.url.startsWith('/g/'));
    const result = { fingerprint, names, legacy, source: { gameId: parsed.data.gameId, buildId: parsed.data.buildId } };
    if (cache.size >= MAX_PLANS && !cache.has(file)) cache.delete(cache.keys().next().value!);
    cache.set(file, result);
    return result;
  } catch {
    return fallback;
  }
}
