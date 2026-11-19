import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CommandError, EXIT, UsageError, type GmCommand, type GmContext } from '../../command.js';
import { printJson, requireAssetsRoot } from '../../context.js';
import {
  assertWorkerRecord,
  discoverTagTargets,
  lockTargets,
  prepareVisualPreviews,
  reconcileCounts,
  restoreSnapshot,
  snapshotTargets,
  validateWorkerCards,
  type TagKind,
} from '../../packs/tag.js';
import {
  effectiveWorkers,
  runJsonWorker,
  resolvePython,
  workerEnvironment,
  type RunJsonWorkerOptions,
  type WorkerRecord,
} from '../../packs/workers.js';

const REPO = fileURLToPath(new URL('../../../../../', import.meta.url));

type Stage = { label: string; script: string; args: string[] };

function stages(kind: TagKind, assetsRoot: string, slugs: readonly string[], workers: number, limit: number): Stage[] {
  const common = [...slugs.flatMap((slug) => ['--only', slug]), '--limit', String(limit), '--json'];
  if (kind === 'audio') {
    return [
      {
        label: 'audio analysis',
        script: 'scripts/py/audio/analyze.py',
        args: ['--packs', join(assetsRoot, 'packs'), '--workers', String(workers), ...common],
      },
      {
        label: 'audio cards',
        script: 'scripts/py/audio/build_audio_cards.py',
        args: ['--packs', join(assetsRoot, 'packs'), ...common],
      },
    ];
  }
  if (kind === 'map') {
    return [
      {
        label: 'map analysis',
        script: 'scripts/py/maps/tag_maps.py',
        args: ['analyse', '--workers', String(workers), '--limit', String(limit), '--json'],
      },
      {
        label: 'map cards',
        script: 'scripts/py/maps/tag_maps.py',
        args: ['cards', '--limit', String(limit), '--json'],
      },
    ];
  }
  return [
    {
      label: `${kind} sheet tags`,
      script: 'scripts/py/tag/tag_sheets.py',
      args: ['--packs', join(assetsRoot, 'packs'), '--kind', kind, ...common],
    },
  ];
}

function visibleRecord(ctx: GmContext, stage: string, record: WorkerRecord): void {
  if (ctx.json) printJson(ctx, { stage, ...record });
  else if (record.card) ctx.out(`${record.card}  ${String(record.status)}`);
}

async function executeStages(options: {
  ctx: GmContext;
  assetsRoot: string;
  kind: TagKind;
  slugs: readonly string[];
  workers: number;
  limit: number;
  records: WorkerRecord[];
}): Promise<void> {
  const env = workerEnvironment({
    assetsRoot: options.assetsRoot,
    workers: options.workers,
    ...(options.ctx.config.eventsFile ? { eventsFile: options.ctx.config.eventsFile } : {}),
  });
  const python = await resolvePython(REPO);
  for (const stage of stages(options.kind, options.assetsRoot, options.slugs, options.workers, options.limit)) {
    const onRecord: RunJsonWorkerOptions['onRecord'] = (record) => {
      assertWorkerRecord(record);
      options.records.push(record);
      if (!record.card) visibleRecord(options.ctx, stage.label, record);
    };
    await runJsonWorker({
      label: stage.label,
      program: python,
      args: ['-I', join(REPO, stage.script), ...stage.args],
      cwd: REPO,
      env,
      onRecord,
    });
  }
}

function parseKind(value: unknown): TagKind {
  if (value === 'audio' || value === 'map' || value === 'model' || value === 'sprite') return value;
  throw new UsageError('--kind must be audio, map, model, or sprite', 'gm help packs tag');
}

async function run(ctx: GmContext, args: string[], flags: Record<string, unknown>): Promise<number> {
  if (args.length > 0) throw new UsageError('packs tag takes no positional arguments', 'gm help packs tag');
  const assetsRoot = requireAssetsRoot(ctx);
  const kind = parseKind(flags.kind);
  const only = typeof flags.only === 'string' ? flags.only : '*';
  const requestedWorkers = Number(flags.workers ?? 0);
  const workers = effectiveWorkers(requestedWorkers);
  const limit = Number(flags.limit ?? ctx.limit);
  const discovery = await discoverTagTargets(assetsRoot, kind, only).catch((error: unknown) => {
    throw new CommandError(error instanceof Error ? error.message : String(error));
  });
  for (const refusal of discovery.refusals) ctx.err(refusal);
  let targets =
    kind === 'map' ? discovery.targets.filter((target) => target.slug === 'profantasy-cc3') : discovery.targets;
  if (targets.length === 0) {
    if (kind === 'map' && discovery.targets.length > 0) ctx.err('map: the local worker supports profantasy-cc3 only');
    if (discovery.refusals.length === 0 && discovery.targets.length === 0)
      ctx.err(`no eligible ${kind} cards matched ${only}`);
    return EXIT.usage;
  }

  const unlock = await lockTargets(targets).catch((error: unknown) => {
    throw new CommandError(error instanceof Error ? error.message : String(error));
  });
  try {
    const lockedRoots = new Set(targets.map((target) => target.root));
    const refreshed = await discoverTagTargets(assetsRoot, kind, only).catch((error: unknown) => {
      throw new CommandError(error instanceof Error ? error.message : String(error));
    });
    targets = refreshed.targets.filter((target) => lockedRoots.has(target.root));
    if (targets.length === 0) throw new CommandError('no eligible collections remain after acquiring locks');
    const snapshot = await snapshotTargets(targets);
    const records: WorkerRecord[] = [];
    let pages: string[] = [];
    let renderers: string[] = [];
    let committed = false;
    try {
      if (kind === 'model' || kind === 'sprite') {
        ({ pages, renderers } = await prepareVisualPreviews({
          assetsRoot,
          targets,
          kind,
          limit,
          software: ctx.config.verifySoftwareGl,
        }));
      }
      const slugs = targets.map((target) => target.slug);
      await executeStages({ ctx, assetsRoot, kind, slugs, workers, limit, records });
      const cards = await validateWorkerCards(assetsRoot, targets, records, snapshot);
      if (cards === 0) throw new Error('worker completed without reporting a card');
      await reconcileCounts(targets, kind);
      const summary = {
        kind,
        only,
        collections: targets.length,
        cards,
        workers: { requested: requestedWorkers, effective: workers },
        pages,
        renderers: [...new Set(renderers)].sort(),
      };
      ctx.emit('packs.tag', summary);
      committed = true;
      for (const record of records) if (record.card) visibleRecord(ctx, kind, record);
      if (ctx.json) printJson(ctx, { summary });
      else ctx.out(`${cards} ${kind} card(s) tagged across ${targets.length} collection(s); workers ${workers}`);
      return EXIT.ok;
    } catch (error) {
      if (committed) {
        throw new CommandError(`tagging completed but output failed: ${String(error)}`);
      }
      try {
        await restoreSnapshot(snapshot);
      } catch (restoreError) {
        throw new CommandError(
          `tagging failed and card restoration also failed: ${String(error)}; restore: ${String(restoreError)}`,
        );
      }
      throw new CommandError(
        `tagging failed; prior cards restored: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } finally {
    await unlock();
  }
}

export const command: GmCommand = {
  name: 'packs tag',
  summary: 'tag one local asset kind with bounded offline workers',
  usage: '--kind <audio|map|model|sprite> [--only <glob>] [--workers <n>] [--limit <n>] [--json]',
  example: 'packs tag --kind audio --only drive-barbarian-chiptune --workers 4 --json',
  flags: {
    kind: { type: 'string', help: 'asset kind: audio, map, model, or sprite' },
    only: { type: 'string', default: '*', help: 'collection id glob' },
    workers: { type: 'number', default: 0, help: 'requested workers; zero uses the safe automatic limit' },
    limit: { type: 'number', default: 0, help: 'at most N cards; zero processes the complete selection' },
  },
  run,
};
