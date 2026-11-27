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
  restorePreviewFailures,
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
  else if (record.card)
    ctx.out(`${record.card}  ${record.skipped ? `skipped: ${String(record.skipped)}` : String(record.status)}`);
  else if (record.progress && typeof record.progress === 'object') {
    const progress = record.progress as { done?: unknown; total?: unknown };
    ctx.err(`${stage}: ${String(progress.done)}/${String(progress.total)} card previews encoded`);
  }
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
  for (const failure of discovery.failures) ctx.err(failure);
  let targets =
    kind === 'map' ? discovery.targets.filter((target) => target.slug === 'profantasy-cc3') : discovery.targets;
  if (targets.length === 0) {
    if (kind === 'map' && discovery.targets.length > 0) ctx.err('map: the local worker supports profantasy-cc3 only');
    if (discovery.refusals.length === 0 && discovery.targets.length === 0)
      ctx.err(`no eligible ${kind} cards matched ${only}`);
    if (ctx.json && discovery.failures.length > 0)
      printJson(ctx, { summary: { kind, only, collections: 0, cards: 0, failures: discovery.failures } });
    return discovery.failures.length > 0 ? EXIT.failed : EXIT.usage;
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
    let previewFailures: WorkerRecord[] = [];
    let selectedPreviews = 0;
    let committed = false;
    try {
      if (kind === 'model' || kind === 'sprite') {
        ({
          pages,
          renderers,
          failures: previewFailures,
          selected: selectedPreviews,
        } = await prepareVisualPreviews({
          assetsRoot,
          targets,
          kind,
          limit,
          software: ctx.config.verifySoftwareGl,
          failures: previewFailures,
        }));
      }
      const slugs = targets.map((target) => target.slug);
      if (selectedPreviews === 0 || previewFailures.length < selectedPreviews) {
        const workerLimit = limit > 0 ? limit - previewFailures.length : 0;
        await executeStages({ ctx, assetsRoot, kind, slugs, workers, limit: workerLimit, records });
      }
      records.push(...previewFailures);
      const validated = await validateWorkerCards(assetsRoot, targets, records, snapshot);
      if (validated === 0) throw new Error('worker completed without reporting a card');
      const cards = validated - previewFailures.length;
      await reconcileCounts(targets, kind);
      const summary = {
        kind,
        only,
        collections: targets.length,
        cards,
        skipped: previewFailures.length,
        failures: [
          ...discovery.failures,
          ...previewFailures.map((record) => `${String(record.card)}: ${String(record.skipped)}`),
        ],
        workers: { requested: requestedWorkers, effective: workers },
        pages,
        renderers: [...new Set(renderers)].sort(),
      };
      ctx.emit('packs.tag', summary);
      committed = true;
      for (const record of records) if (record.card) visibleRecord(ctx, kind, record);
      if (ctx.json) printJson(ctx, { summary });
      else
        ctx.out(
          `${cards} ${kind} card(s) tagged, ${previewFailures.length} skipped across ${targets.length} collection(s); workers ${workers}`,
        );
      return discovery.failures.length > 0 || previewFailures.length > 0 ? EXIT.failed : EXIT.ok;
    } catch (error) {
      if (committed) {
        throw new CommandError(`tagging completed but output failed: ${String(error)}`);
      }
      try {
        await restoreSnapshot(snapshot);
        await restorePreviewFailures(assetsRoot, targets, previewFailures);
      } catch (restoreError) {
        throw new CommandError(
          `tagging failed and card restoration also failed: ${String(error)}; restore: ${String(restoreError)}`,
        );
      }
      if (previewFailures.length > 0) {
        for (const record of previewFailures) visibleRecord(ctx, kind, record);
        if (ctx.json) {
          printJson(ctx, {
            summary: {
              kind,
              only,
              collections: targets.length,
              cards: 0,
              skipped: previewFailures.length,
              failures: [
                ...discovery.failures,
                ...previewFailures.map((record) => `${String(record.card)}: ${String(record.skipped)}`),
                error instanceof Error ? error.message : String(error),
              ],
              rolledBack: true,
            },
          });
        }
      }
      throw new CommandError(
        `tagging failed; prior cards restored${previewFailures.length ? `; ${previewFailures.length} preview skip(s) recorded` : ''}: ${error instanceof Error ? error.message : String(error)}`,
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
