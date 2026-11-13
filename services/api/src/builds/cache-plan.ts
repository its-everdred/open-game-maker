import { createHash, randomUUID } from 'node:crypto';
import { open, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, sep } from 'node:path';

import { cachePlanSchema, type CachePlan, type CachePlanEntry, type LoadPhase, type Tier } from '@ogm/contracts';
import { buildDir, putBlob } from '@ogm/games-host/layout';

const CODE_EXTENSIONS = new Set(['.css', '.html', '.js', '.mjs']);
const TIERS = ['desktop', 'mobile', 'low'] as const satisfies readonly Tier[];

export class BuildCacheError extends Error {
  constructor(code: string) {
    super(code);
    this.name = 'BuildCacheError';
  }
}

export async function completeBuildCache(input: {
  root: string;
  files: string;
  gameId: string;
  buildId: string;
  previousBuildId: string | null;
  sdkVersion: string;
  privateAssets?: boolean;
}): Promise<void> {
  const assetDirectory = join(input.files, 'a');
  const assetFiles = await fileNames(assetDirectory);
  const planFile = join(input.files, 'assets', 'cache-plan.json');
  const plan = await readPlan(planFile, assetFiles.length === 0);
  if (!plan) return;

  await storeAssets(input.root, assetDirectory, assetFiles, plan, input.privateAssets === true);
  if (input.privateAssets) {
    await rewritePrivateManifest(input.files);
  } else {
    await rm(assetDirectory, { recursive: true, force: true });
  }

  const codeEntries = await codeFiles(input.files);
  const entries = [...plan.entries.filter(({ kind }) => kind !== 'code'), ...codeEntries];
  const completed: CachePlan = {
    ...plan,
    gameId: input.gameId,
    buildId: input.buildId,
    sdkVersion: input.sdkVersion,
    entries: input.privateAssets ? entries.map((entry) => ({ ...entry, url: privateUrl(entry.url) })) : entries,
    totals: totalsFor(plan.tiers, entries),
  };
  if (input.previousBuildId) {
    completed.lineage = lineageFor(
      input.previousBuildId,
      await previousPlan(input.root, input.gameId, input.previousBuildId),
      completed,
    );
  } else {
    delete completed.lineage;
  }

  const parsed = cachePlanSchema.parse(completed);
  const temporary = `${planFile}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx');
    try {
      await handle.writeFile(`${JSON.stringify(parsed, null, 2)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, planFile);
    const directory = await open(dirname(planFile), 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

async function readPlan(path: string, missingAllowed: boolean): Promise<CachePlan | null> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && missingAllowed) return null;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new BuildCacheError('cache_plan_missing');
    throw error;
  }
  try {
    return cachePlanSchema.parse(JSON.parse(raw) as unknown);
  } catch {
    throw new BuildCacheError('cache_plan_invalid');
  }
}

async function previousPlan(root: string, gameId: string, buildId: string): Promise<CachePlan | null> {
  return readPlan(join(buildDir(root, gameId, buildId), 'assets', 'cache-plan.json'), true);
}

async function fileNames(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  });
  if (entries.some((entry) => !entry.isFile())) throw new BuildCacheError('asset_directory_invalid');
  return entries.map(({ name }) => name).sort();
}

async function storeAssets(
  root: string,
  directory: string,
  files: string[],
  plan: CachePlan,
  privateAssets: boolean,
): Promise<void> {
  const planned = new Map(
    plan.entries
      .filter(({ url }) => url.startsWith('/a/'))
      .map((entry) => [entry.url.slice('/a/'.length), entry] as const),
  );
  if (planned.size !== files.length || files.some((file) => !planned.has(file))) {
    throw new BuildCacheError('cache_plan_assets_mismatch');
  }
  for (const file of files) {
    const source = join(directory, file);
    const bytes = await readFile(source);
    const entry = planned.get(file)!;
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== entry.sha256 || !file.startsWith(`${sha256}.`) || bytes.length !== entry.bytes) {
      throw new BuildCacheError('cache_plan_assets_mismatch');
    }
    if (!privateAssets) await putBlob(root, source);
  }
}

function privateUrl(value: string): string {
  return value.startsWith('/a/') ? `../a/${value.slice(3)}` : value;
}

function privateValue(value: unknown): unknown {
  if (typeof value === 'string') return privateUrl(value);
  if (Array.isArray(value)) return value.map(privateValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [privateUrl(key), privateValue(child)]));
  }
  return value;
}

async function rewritePrivateManifest(files: string): Promise<void> {
  const path = join(files, 'assets', 'manifest.json');
  const raw = await readFile(path, 'utf8').catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  if (raw !== null) await writeFile(path, `${JSON.stringify(privateValue(JSON.parse(raw) as unknown), null, 2)}\n`);
}

async function codeFiles(root: string): Promise<CachePlanEntry[]> {
  const paths = await walk(root);
  const entries = await Promise.all(
    paths
      .filter((path) => CODE_EXTENSIONS.has(extname(path)))
      .map(async (path): Promise<CachePlanEntry> => {
        const bytes = await readFile(path);
        return {
          sha256: createHash('sha256').update(bytes).digest('hex'),
          url: relative(root, path).split(sep).join('/'),
          bytes: bytes.length,
          kind: 'code',
          phase: 'boot',
          tiers: ['*'],
        };
      }),
  );
  return entries.sort((left, right) => left.url.localeCompare(right.url));
}

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await walk(path)));
    else if (entry.isFile()) paths.push(path);
  }
  return paths;
}

function totalsFor(tiers: CachePlan['tiers'], entries: CachePlanEntry[]): CachePlan['totals'] {
  const phaseTotals = (): Record<LoadPhase, { bytes: number; files: number }> => ({
    boot: { bytes: 0, files: 0 },
    ready: { bytes: 0, files: 0 },
    stream: { bytes: 0, files: 0 },
  });
  const totals: CachePlan['totals'] = {
    desktop: phaseTotals(),
    mobile: phaseTotals(),
    low: phaseTotals(),
  };
  for (const entry of entries) {
    for (const tier of tiers) {
      if (!entry.tiers.includes('*') && !entry.tiers.includes(tier)) continue;
      totals[tier][entry.phase].bytes += entry.bytes;
      totals[tier][entry.phase].files += 1;
    }
  }
  return totals;
}

function lineageFor(previousBuildId: string, previous: CachePlan | null, current: CachePlan) {
  const previousHashes = new Set(previous?.entries.map(({ sha256 }) => sha256) ?? []);
  const currentHashes = new Set(current.entries.map(({ sha256 }) => sha256));
  const added = [...currentHashes].filter((sha256) => !previousHashes.has(sha256)).sort();
  const removed = [...previousHashes].filter((sha256) => !currentHashes.has(sha256)).sort();
  const addedBytes = { desktop: 0, mobile: 0, low: 0 } satisfies Record<Tier, number>;
  for (const sha256 of added) {
    const matching = current.entries.filter((entry) => entry.sha256 === sha256);
    const bytes = matching[0]?.bytes ?? 0;
    if (matching.some((entry) => entry.bytes !== bytes)) throw new BuildCacheError('cache_plan_hash_size_mismatch');
    for (const tier of TIERS) {
      if (
        current.tiers.includes(tier) &&
        matching.some((entry) => entry.tiers.includes('*') || entry.tiers.includes(tier))
      ) {
        addedBytes[tier] += bytes;
      }
    }
  }
  return { previousBuildId, added, removed, addedBytes };
}
