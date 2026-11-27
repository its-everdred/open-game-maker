import { readFile, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { cachePlanSchema } from '@ogm/contracts';

// The API checks the current game state and revalidates the holder's membership and grant on every request.
export async function mayReadGame(api: string, gameId: string, token: string | undefined): Promise<boolean> {
  try {
    const response = await fetch(
      `${api.replace(/\/$/u, '')}/api/v1/internal/games/${encodeURIComponent(gameId)}/build-access`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(token ? { token } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      },
    );
    return response.status === 204;
  } catch {
    return false;
  }
}

type PlanRef = { gameId: string; directory: string; path: string };
type BlobIndex = Map<string, PlanRef[]>;
const indexes = new Map<string, { expires: number; pending: Promise<BlobIndex | null> }>();

async function readPlan(path: string) {
  const raw = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (raw === null) return null;
  return cachePlanSchema.parse(JSON.parse(raw) as unknown);
}

async function buildIndex(root: string): Promise<BlobIndex | null> {
  try {
    const index: BlobIndex = new Map();
    for (const game of await readdir(root, { withFileTypes: true })) {
      if (!game.isDirectory() || game.name.startsWith('_') || game.name.startsWith('.')) continue;
      for (const build of await readdir(join(root, game.name), { withFileTypes: true })) {
        if (!build.isDirectory() || build.name.startsWith('.')) continue;
        const directory = join(root, game.name, build.name);
        if (
          !(await access(join(directory, '.complete')).then(
            () => true,
            () => false,
          ))
        )
          continue;
        const path = join(directory, 'assets', 'cache-plan.json');
        const plan = await readPlan(path).catch(() => null);
        if (!plan) continue;
        for (const entry of plan.entries) {
          if (!entry.url.startsWith('/a/')) continue;
          const file = entry.url.slice(3);
          const refs = index.get(file) ?? [];
          refs.push({ gameId: game.name, directory, path });
          index.set(file, refs);
        }
      }
    }
    return index;
  } catch {
    return null;
  }
}

// Share scans across simultaneous requests, but re-read every candidate plan and current game policy before allowing a
// blob. A stale index can briefly deny a new blob; it cannot authorize one after its public reference is removed.
export async function blobOwners(root: string, file: string): Promise<string[] | null> {
  let entry = indexes.get(root);
  if (!entry || Date.now() >= entry.expires) {
    const next = { expires: Number.POSITIVE_INFINITY, pending: buildIndex(root) };
    next.pending = next.pending.then((index) => {
      next.expires = Date.now() + 1000;
      return index;
    });
    entry = next;
    indexes.set(root, entry);
  }
  const index = await entry.pending;
  if (!index) return null;
  try {
    const owners = new Set<string>();
    for (const ref of index.get(file) ?? []) {
      if (
        !(await access(join(ref.directory, '.complete')).then(
          () => true,
          () => false,
        ))
      )
        continue;
      const plan = await readPlan(ref.path);
      if (plan?.entries.some((item) => item.url === `/a/${file}`)) owners.add(ref.gameId);
    }
    return [...owners];
  } catch {
    return null;
  }
}
