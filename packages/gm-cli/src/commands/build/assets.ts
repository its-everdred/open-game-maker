import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

import { loadIndex } from '@ogm/asset-cards';
import { tierSchema, type Tier } from '@ogm/contracts';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { requireAssetsRoot } from '../../context.js';
import { readLock } from '../../lock.js';
import { entrySource } from '../../resolve.js';
import { command as checkAssetsCommand } from '../check/assets.js';
import { buildAudio } from './assets/audio.js';
import { budgetReport } from './assets/budget.js';
import { cacheIdentity, loadCached, saveBuilt, sourceDigest } from './assets/cache.js';
import { assertNoSymlinks, executableExists, resolveOutputDir, writeIfChanged } from './assets/files.js';
import { buildFont } from './assets/font.js';
import { buildImage } from './assets/image.js';
import { buildKit } from './assets/kit.js';
import { assembleManifest, writeManifest } from './assets/manifest.js';
import { buildModel } from './assets/model.js';
import { planBuild } from './assets/plan.js';
import type { AssetBudgetReport, BuildFailure, BuildJob, CompletedJob, FreshJobResult } from './assets/types.js';

function parseTiers(value: unknown): Tier[] {
  if (typeof value !== 'string') throw new UsageError('--tier needs a comma-separated list', 'gm build assets');
  const tiers = [
    ...new Set(
      value
        .split(',')
        .map((tier) => tier.trim())
        .filter(Boolean),
    ),
  ];
  if (tiers.length === 0 || tiers.some((tier) => !tierSchema.safeParse(tier).success)) {
    throw new UsageError('--tier must contain desktop, mobile, or low', 'gm build assets --tier desktop,mobile,low');
  }
  return tiers as Tier[];
}

function parseBudget(value: unknown, tiers: Tier[]): Tier {
  const parsed = tierSchema.safeParse(value);
  if (!parsed.success)
    throw new UsageError('--budget must be desktop, mobile, or low', 'gm build assets --budget mobile');
  if (!tiers.includes(parsed.data)) {
    throw new UsageError(`--budget ${parsed.data} is not in --tier`, `gm build assets --tier ${parsed.data}`);
  }
  return parsed.data;
}

async function buildFresh(job: BuildJob): Promise<FreshJobResult> {
  if (job.kind === 'kit') return buildKit(job);
  if (job.kind === 'model') return buildModel(job);
  if (job.kind === 'image') return buildImage(job);
  if (job.kind === 'audio') return buildAudio(job);
  return buildFont(job);
}

function printReports(ctx: Parameters<GmCommand['run']>[0], reports: AssetBudgetReport[], budgetTier: Tier): void {
  ctx.out('tier  bytes  files  tris  gpuTexMB  maxTexture');
  for (const report of reports) {
    ctx.out(
      `${report.tier} ${report.phase ?? 'boot'}  ${report.bytes}  ${report.files}  ${report.tris}  ${report.gpuTexMB.toFixed(2)}  ${report.maxTexture}`,
    );
    for (const item of report.tier === budgetTier ? report.exceeded : []) {
      ctx.err(`${report.tier} budget exceeded: ${report.phase ?? 'boot'} ${item.metric} ${item.value} > ${item.limit}`);
    }
  }
}

async function runAssetCheck(ctx: Parameters<GmCommand['run']>[0]): Promise<number> {
  const output: string[] = [];
  const errors: string[] = [];
  const code = await checkAssetsCommand.run(
    { ...ctx, out: (line) => output.push(line), err: (line) => errors.push(line) },
    [],
    { publish: false, skipFiles: true },
  );
  if (code !== EXIT.ok) {
    output.forEach(ctx.out);
    errors.forEach(ctx.err);
  }
  return code;
}

function reportBuildFailures(
  ctx: Parameters<GmCommand['run']>[0],
  payload: {
    tiers: Tier[];
    failures: BuildFailure[];
    strict: boolean;
    cacheHits?: number;
    cacheMisses?: number;
  },
): void {
  if (ctx.json) ctx.out(JSON.stringify(payload));
  else payload.failures.forEach((failure) => ctx.err(`${failure.id}: ${failure.message}`));
  ctx.emit('assets.build', payload);
}

export const command: GmCommand = {
  name: 'build assets',
  summary: 'build tiered, content-hashed game assets and enforce budgets',
  usage: '[--tier desktop,mobile,low] [--budget mobile] [--out public/a] [--ktx2] [--no-cache] [--strict]',
  example: 'build assets --tier desktop,mobile,low --budget mobile --json',
  flags: {
    tier: { type: 'string', default: 'desktop,mobile,low', help: 'comma-separated output tiers' },
    budget: { type: 'string', default: 'mobile', help: 'tier whose limits determine the exit code' },
    out: { type: 'string', default: 'public/a', help: 'generated asset file directory inside the game repo' },
    ktx2: { type: 'boolean', default: false, help: 'encode KTX2 textures when the external tool is available' },
    'no-cache': { type: 'boolean', default: false, help: 'ignore and do not update the asset cache' },
    strict: { type: 'boolean', default: false, help: 'stop at the first asset failure' },
  },
  async run(ctx, args, flags) {
    if (args.length > 0) throw new UsageError('build assets takes no positional arguments', 'gm build assets --help');
    if (flags.ktx2 === true) {
      if (!(await executableExists('toktx'))) {
        throw new UsageError('toktx not found', 'gm build assets without --ktx2');
      }
      throw new UsageError('KTX2 encoding is not available in V1', 'gm build assets without --ktx2');
    }
    const tiers = parseTiers(flags.tier);
    const budgetTier = parseBudget(flags.budget, tiers);
    const outDir = resolveOutputDir(ctx.cwd, flags.out as string);
    const manifestDir = resolveOutputDir(ctx.cwd, 'public/assets');
    const strict = flags.strict === true;
    const useCache = flags['no-cache'] !== true;

    await assertNoSymlinks(ctx.cwd, join(ctx.cwd, 'assets.lock.json'));
    let lock;
    try {
      lock = await readLock(ctx.cwd);
    } catch {
      return runAssetCheck(ctx);
    }
    if (!lock) throw new UsageError('assets.lock.json not found', 'gm assets use <id>');
    await assertNoSymlinks(ctx.cwd, outDir);
    await assertNoSymlinks(ctx.cwd, manifestDir);
    await assertNoSymlinks(ctx.cwd, join(ctx.cwd, '.gm/cache/assets'));
    for (const entry of lock.assets) {
      if (entrySource(entry) === 'vendored') await assertNoSymlinks(ctx.cwd, join(ctx.cwd, entry.path));
    }

    const checkCode = await runAssetCheck(ctx);
    if (checkCode !== EXIT.ok) return checkCode;

    const collections = lock.assets.some((entry) => entrySource(entry) === 'library')
      ? (await loadIndex(requireAssetsRoot(ctx))).collections
      : {};
    const planned = await planBuild(lock, ctx.cwd, tiers, useCache, {
      cwd: ctx.cwd,
      assetsRoot: ctx.assetsRoot,
      blobRoot: ctx.blobRoot,
      collections,
    });
    const failures: BuildFailure[] = [...planned.failures];
    if (strict && failures.length > 0) {
      reportBuildFailures(ctx, { tiers, failures: failures.slice(0, 1), strict });
      return EXIT.failed;
    }

    const results: CompletedJob[] = [];
    let cacheHits = 0;
    let cacheMisses = 0;
    for (const job of planned.jobs) {
      try {
        const identity = await cacheIdentity(job);
        const cached = useCache ? await loadCached(identity, ctx.cwd, outDir) : null;
        if (cached) {
          if ((await sourceDigest(job, true)) !== identity.sourceHash)
            throw new Error('source changed during build; retry');
          results.push({ job, result: cached });
          cacheHits += 1;
        } else {
          const built = await buildFresh(job);
          if ((await sourceDigest(job, true)) !== identity.sourceHash)
            throw new Error('source changed during build; retry');
          results.push({ job, result: await saveBuilt(identity, ctx.cwd, outDir, built, useCache) });
          cacheMisses += 1;
        }
      } catch (error) {
        const failure = {
          id: job.items.map((item) => item.entry.id).join(','),
          message: error instanceof Error ? error.message : String(error),
        };
        failures.push(failure);
        if (strict) break;
      }
    }

    if (failures.length > 0) {
      reportBuildFailures(ctx, { tiers, failures, strict, cacheHits, cacheMisses });
      return EXIT.failed;
    }

    const { manifest, cachePlan, details } = assembleManifest(
      tiers,
      results,
      lock.assets.map((entry) => entry.id),
    );
    let lazyBudgets: Record<string, { mobile?: number; desktop?: number }> = {};
    try {
      const game = JSON.parse(await readFile(join(ctx.cwd, '.gm/game.json'), 'utf8')) as {
        budgets?: { lazy?: typeof lazyBudgets };
      };
      lazyBudgets = game.budgets?.lazy ?? {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const phases = [
      'boot',
      ...new Set(
        Object.values(manifest.assets)
          .map((asset) => asset.phase ?? 'boot')
          .filter((phase) => phase !== 'boot'),
      ),
    ];
    const reports = tiers.flatMap((tier) =>
      phases.map((phase) => {
        const group = phase.slice('lazy:'.length);
        const configured = lazyBudgets[group] ?? lazyBudgets[group.split('-')[0]!];
        const limit =
          phase === 'boot'
            ? undefined
            : tier === 'desktop'
              ? (configured?.desktop ?? 4 * 1024 * 1024)
              : (configured?.mobile ?? 1.5 * 1024 * 1024);
        if (limit !== undefined && (!Number.isFinite(limit) || limit < 0))
          throw new Error(`Invalid budget for ${phase}`);
        return budgetReport(manifest, details, tier, phase, limit, cachePlan);
      }),
    );
    await writeIfChanged(join(manifestDir, 'budget.json'), `${JSON.stringify(reports, null, 2)}\n`, ctx.cwd);
    await writeManifest(ctx.cwd, manifestDir, manifest, cachePlan);
    const selected = reports.filter((report) => report.tier === budgetTier);
    const payload = {
      tiers,
      files: Object.keys(manifest.files).length,
      assets: Object.keys(manifest.assets).length,
      reports,
      cacheHits,
      cacheMisses,
    };
    ctx.emit('assets.build', payload);
    if (ctx.json) ctx.out(JSON.stringify({ manifest, reports, cache: { hits: cacheHits, misses: cacheMisses } }));
    else printReports(ctx, reports, budgetTier);
    return selected.some((report) => report.exceeded.length > 0) ? EXIT.failed : EXIT.ok;
  },
};
