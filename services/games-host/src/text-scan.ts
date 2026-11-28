import { readFile, stat } from 'node:fs/promises';

type Scan = { status: 'unchanged' | 'missing' } | { status: 'rewritten'; text: string };
const unchanged = new Map<string, string>();
const pending = new Map<string, Promise<Scan>>();
const MAX_ENTRIES = 4096;

/** Cache negative scans by file identity, so ordinary bundles keep their streaming path. */
export async function scanLegacyText(
  file: string,
  scope: string,
  buildRoots: string[],
  rewrite: (text: string) => string,
): Promise<Scan> {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return { status: 'missing' };
  const fingerprint = `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
  const cacheKey = `${file}\0${scope}`;
  if (unchanged.get(cacheKey) === fingerprint) return { status: 'unchanged' };
  const key = `${cacheKey}\0${fingerprint}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const scan = (async (): Promise<Scan> => {
    const text = await readFile(file, 'utf8').catch(() => null);
    if (text === null) return { status: 'missing' };
    const after = await stat(file).catch(() => null);
    if (!after || `${after.dev}:${after.ino}:${after.size}:${after.mtimeMs}:${after.ctimeMs}` !== fingerprint)
      return { status: 'missing' };
    if (/\/a\/[0-9a-f]{64}\.[a-z0-9]{1,12}/u.test(text) || buildRoots.some((root) => text.includes(root))) {
      const rewritten = rewrite(text);
      if (rewritten !== text) return { status: 'rewritten', text: rewritten };
    }
    if (unchanged.size >= MAX_ENTRIES && !unchanged.has(cacheKey)) unchanged.delete(unchanged.keys().next().value!);
    unchanged.set(cacheKey, fingerprint);
    return { status: 'unchanged' };
  })();
  pending.set(key, scan);
  try {
    return await scan;
  } finally {
    pending.delete(key);
  }
}
