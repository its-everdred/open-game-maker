import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import type { GateResult, RunL0Options } from '@ogm/gm-verify';

import { EXIT, UsageError, type GmCommand, type GmContext } from '../../command.js';
import { command as assetsCommand } from './assets.js';
import { command as lookCommand } from '../look/check.js';
import { gameDir, workspaceRoot } from '../../outbox.js';
import { checkLoading } from '../../loading-check.js';
import { checkImageSlots } from '../../image-slots-check.js';
import { checkPlayArea } from '../../play-area-check.js';
import { findPlayAreaGame } from '../../play-area-config.js';
import { checkPrReview } from '../../pr-review-check.js';
import { entriesForTicket, readInventory } from '../../decision-inventory.js';
import { reviewScreens } from '../../look/screens.js';
import { recipeSchema } from '../../sprite-forge.js';

function ticketLabels(body: string): Set<string> {
  return new Set(
    [...body.matchAll(/(?:^|\s)(lane:[a-z-]+|phase:[a-z-]+|design:[a-z-]+)(?=\s|$)/gim)].map((match) =>
      match[1]!.toLowerCase(),
    ),
  );
}

type MockRecord = { kind?: unknown; refs?: unknown; out?: unknown; file?: unknown; prompt?: unknown };

function mockRecord(path: string, cwd: string): MockRecord | null {
  if (!path.endsWith('.json')) return null;
  try {
    const value = JSON.parse(readFileSync(join(cwd, path), 'utf8')) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) && (value as MockRecord).kind === 'image'
      ? (value as MockRecord)
      : null;
  } catch {
    return null;
  }
}

function mockReferenceProblems(changed: string[], cwd: string, ogmGlass: boolean): string[] {
  const records = changed.flatMap((path) => {
    const record = mockRecord(path, cwd);
    return record ? [{ path, record }] : [];
  });
  const images = changed.filter((path) => /\.(?:png|jpe?g|webp)$/i.test(path));
  const problems: string[] = [];
  if ((images.length > 0 || ogmGlass) && records.length === 0)
    problems.push(
      `phase:mock images need a changed request-mock image record with ${ogmGlass ? 'design' : 'pack'} refs`,
    );

  const recordedImages = new Set<string>();
  for (const { path, record } of records) {
    const refs = Array.isArray(record.refs)
      ? [...new Set(record.refs.filter((ref): ref is string => typeof ref === 'string' && ref.length > 0))]
      : [];
    const packRefs = refs.filter((ref) => /^assets-local\/(?:packs|sets)\//.test(ref));
    const logoRef = refs.some((ref) => /(?:^|\/)(?:logo\/|[^/]*logo[^/]*\.(?:png|jpe?g|webp)$)/i.test(ref));
    const logoScreen =
      typeof record.prompt === 'string' && /\b(title|loading|end(?: screen)?|thumbnail)\b/i.test(record.prompt);
    const designRef = refs.some(
      (ref) =>
        /^(?:docs\/design\/ogm-glass|tests\/design-baselines\/ogm-glass|assets-local\/review\/design-ogm-glass)\/.+\.(?:png|jpe?g|webp)$/i.test(
          ref,
        ) &&
        !ref.split('/').includes('..') &&
        existsSync(join(cwd, ref)),
    );
    if (ogmGlass && !designRef) problems.push(`${path} needs an approved OGM glass design image reference`);
    if (!ogmGlass && packRefs.length < 2 && !(refs.length === 1 && logoRef && logoScreen))
      problems.push(
        `${path} needs at least two assets-local/packs or assets-local/sets refs (or the game logo for a title/loading/end/thumbnail mock)`,
      );

    if (typeof record.out !== 'string' || typeof record.file !== 'string') {
      problems.push(`${path} does not identify its generated image`);
      continue;
    }
    const imagePath = join(record.out, record.file).replaceAll('\\', '/');
    recordedImages.add(imagePath);
    if (!images.includes(imagePath)) problems.push(`${path} has no generated image attached at ${imagePath}`);
  }
  for (const image of images)
    if (!recordedImages.has(image)) problems.push(`${image} has no matching request-mock image record`);
  return problems;
}

function coveredGlassScreen(
  cwd: string,
  base: string,
  ticket: string | undefined,
  screen: string | undefined,
): boolean {
  if (!ticket || !screen || !/^[A-Za-z0-9_-]+$/.test(screen)) return false;
  try {
    const screens = execFileSync('git', ['show', `${base}:docs/design/ogm-glass/screens.md`], {
      cwd,
      encoding: 'utf8',
    });
    return screens
      .split('\n')
      .some(
        (line) =>
          line.startsWith('|') &&
          line.includes(`#artboard-${screen})`) &&
          new RegExp(`(?:^|\\D)#${ticket}(?!\\d)`).test(line),
      );
  } catch {
    return false;
  }
}

function ticketGate(
  cwd: string,
  body: string,
  base: string,
  lane?: string,
  phase?: string,
  design?: string,
  screen?: string,
): string[] {
  const labels = ticketLabels(body);
  if (lane) labels.add(`lane:${lane}`);
  if (phase) labels.add(`phase:${phase}`);
  if (design) labels.add(`design:${design}`);
  if (!labels.has('lane:creative') && !labels.has('lane:clone')) return [];
  const problems: string[] = [];
  let changed: string[];
  try {
    changed = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { cwd, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
  } catch {
    return [`cannot compare ticket changes with base ${base}`];
  }
  const effectiveLabels = new Set(labels);
  if (effectiveLabels.has('lane:creative') && effectiveLabels.has('phase:mock')) {
    const source = changed.filter((path) => /^(?:games\/[^/]+\/src|src)\//.test(path));
    if (source.length) problems.push(`phase:mock may not change game source: ${source.join(', ')}`);
    problems.push(...mockReferenceProblems(changed, cwd, effectiveLabels.has('design:ogm-glass')));
  }
  if (
    effectiveLabels.has('lane:creative') &&
    (effectiveLabels.has('phase:prototype') || effectiveLabels.has('phase:build'))
  ) {
    const ticketNumber = /\b(?:closes|refs|fixes|resolves)\s+#(\d+)/i.exec(body)?.[1];
    let game = cwd;
    let root = cwd;
    try {
      root = workspaceRoot(cwd);
      game = gameDir(cwd, root);
    } catch {
      // The ticket gate can run in a bare worktree fixture without a manifest.
    }
    const slug = basename(game);
    const requiredApprovalPhase = effectiveLabels.has('phase:build') ? 'prototype' : 'mock';
    const phaseRank = ['mock', 'prototype', 'build', 'polish'];
    const hasApprovalPhase = (phase: unknown) => {
      if (typeof phase !== 'string') return false;
      const phaseIndex = phaseRank.indexOf(phase);
      return phaseIndex >= 0 && phaseIndex >= phaseRank.indexOf(requiredApprovalPhase);
    };
    let hasApprovedScreen = false;
    try {
      hasApprovedScreen = reviewScreens(game).some(
        (screen) => typeof screen.target === 'string' && hasApprovalPhase(screen.phase),
      );
    } catch {
      // A missing review deck has no approved screen targets.
    }
    let hasTicketDecision = false;
    if (ticketNumber) {
      try {
        const inventory = readInventory(join(root, 'docs', slug, 'decisions.json'));
        hasTicketDecision = entriesForTicket(inventory, ticketNumber).some(
          (decision) =>
            decision.status === 'answered' &&
            typeof decision.answer === 'string' &&
            hasApprovalPhase(decision.phase) &&
            decision.options.length > 0 &&
            decision.options.every((option) => typeof option.media === 'string' && option.media.length > 0),
        );
      } catch {
        hasTicketDecision = false;
      }
    }
    const recorded = hasApprovedScreen || hasTicketDecision;
    if (
      !recorded &&
      !(
        effectiveLabels.has('phase:prototype') &&
        effectiveLabels.has('design:ogm-glass') &&
        coveredGlassScreen(cwd, base, ticketNumber, screen)
      )
    )
      problems.push(
        `lane:creative ${effectiveLabels.has('phase:build') ? 'phase:build needs an approved prototype' : 'phase:prototype needs an approved mock'} recorded in review/decisions.json or docs/<slug>/decisions.json`,
      );
  }
  if (effectiveLabels.has('lane:clone')) {
    const recipeFiles = changed.filter((path) => path.endsWith('/recipe.json') || path === 'recipe.json');
    if (!recipeFiles.length) problems.push('lane:clone requires a recipe.json in the PR');
    for (const path of recipeFiles) {
      try {
        const value: unknown = JSON.parse(readFileSync(join(cwd, path), 'utf8'));
        const parsed = recipeSchema.safeParse(value);
        if (!parsed.success) {
          problems.push(`${path} is not a valid sprite-forge recipe`);
          continue;
        }
        const recipe = parsed.data;
        const outputPath = join(dirname(path), recipe.output).replaceAll('\\', '/');
        if (!changed.includes(outputPath) || !existsSync(join(cwd, outputPath)))
          problems.push(`${path} has no generated sprite attached at ${outputPath}`);
        if (!recipe.approved_by_creator) problems.push(`${path} has no creator approval`);
        const roundPrefix = path.slice(0, -'recipe.json'.length);
        const originalPrefix = `${roundPrefix}originals/`;
        const attachedOriginals = changed.filter(
          (candidate) => candidate.startsWith(originalPrefix) && /\.(?:png|jpe?g|webp)$/i.test(candidate),
        );
        if (attachedOriginals.length === 0)
          problems.push(`${path} has no original media attached under ${originalPrefix}`);
        if (Object.keys(recipe.scores).length === 0) problems.push(`${path} has no gm-sprite-forge gate scores`);
        if (
          !recipe.gate_results ||
          Object.keys(recipe.gate_results).length === 0 ||
          Object.values(recipe.gate_results).some((result) => result.pass !== true)
        )
          problems.push(`${path} has missing or failing gm-sprite-forge gate results`);
      } catch {
        problems.push(`${path} is not readable JSON`);
      }
    }
  }
  return problems;
}

export function printGate(ctx: GmContext, result: GateResult): number {
  if (ctx.json) ctx.out(JSON.stringify(result));
  else {
    for (const check of result.checks.filter((item) => !item.ok)) {
      const location = check.file
        ? `${check.file}${check.line === undefined ? '' : `:${check.line}`} `
        : `${check.id} `;
      ctx.err(`${location}${check.detail ?? 'failed'}`);
    }
  }
  return result.ok ? EXIT.ok : EXIT.failed;
}

export async function runSelected(ctx: GmContext, checks: RunL0Options): Promise<number> {
  const verify = await import('@ogm/gm-verify');
  return printGate(ctx, verify.runL0(ctx.cwd, checks));
}

export const command: GmCommand = {
  name: 'check',
  summary: 'run deterministic static, hook, and asset gates',
  usage:
    '[--body <file>] [--base <ref>] [--lane <creative|clone>] [--phase <mock|prototype|build|polish>] [--design ogm-glass] [--design-screen <artboard>] [--json]',
  example: 'check',
  flags: {
    body: { type: 'string', help: 'pull request body markdown for ticket PR gates' },
    base: { type: 'string', help: 'base ref for changed-file detection (default origin/main)' },
    lane: { type: 'string', help: 'ticket lane for ticket PR gates: creative or clone' },
    phase: { type: 'string', help: 'current look rung: mock, prototype, build, or polish' },
    design: { type: 'string', help: 'approved design from ticket label: ogm-glass' },
    'design-screen': { type: 'string', help: 'covered glass artboard identifier' },
  },
  async run(ctx, args, flags) {
    if (args.length > 0) throw new UsageError(`unexpected argument ${args[0]}`, 'gm help check');
    const phase = flags.phase as string | undefined;
    if (phase !== undefined && !['mock', 'prototype', 'build', 'polish'].includes(phase))
      throw new UsageError(`invalid look phase "${phase}"`, 'use --phase mock|prototype|build|polish');
    const lane = flags.lane as string | undefined;
    if (lane !== undefined && !['creative', 'clone'].includes(lane))
      throw new UsageError(`invalid ticket lane "${lane}"`, 'use --lane creative|clone');
    const design = flags.design as string | undefined;
    if (design !== undefined && design !== 'ogm-glass')
      throw new UsageError(`invalid approved design "${design}"`, 'use --design ogm-glass');
    const screen = flags['design-screen'] as string | undefined;
    const verify = await import('@ogm/gm-verify');
    const gate = verify.runL0(ctx.cwd);

    const out: string[] = [];
    const err: string[] = [];
    const assetCode = await assetsCommand.run(
      { ...ctx, out: (line) => out.push(line), err: (line) => err.push(line) },
      [],
      {},
    );
    let lookCode: number = EXIT.ok;
    let lookReport: unknown;
    let loadingErrors: string[] = [];
    let imageErrors: string[] = [];
    let playArea: Awaited<ReturnType<typeof checkPlayArea>> | undefined;
    const prProblems =
      typeof flags.body === 'string'
        ? [
            ...checkPrReview(ctx.cwd, flags.body, typeof flags.base === 'string' ? flags.base : 'origin/main'),
            ...ticketGate(
              ctx.cwd,
              (() => {
                try {
                  return readFileSync(resolve(ctx.cwd, flags.body as string), 'utf8');
                } catch {
                  return '';
                }
              })(),
              typeof flags.base === 'string' ? flags.base : 'origin/main',
              lane,
              phase,
              design,
              screen,
            ),
          ]
        : [];
    if (!ctx.json) prProblems.forEach(ctx.err);
    let game = ctx.cwd;
    try {
      game = gameDir(ctx.cwd);
    } catch {
      // The static gate also works outside a game repository.
    }
    const playAreaGame = findPlayAreaGame(ctx.cwd, game);
    if (playAreaGame) {
      playArea = await checkPlayArea(ctx, playAreaGame);
      if (!ctx.json) playArea.output.forEach(playArea.ok ? ctx.out : ctx.err);
    }
    if (existsSync(join(game, 'gm.manifest.json'))) {
      loadingErrors = await checkLoading(game);
      imageErrors = await checkImageSlots(game);
      if (!ctx.json) loadingErrors.forEach(ctx.err);
      if (!ctx.json) imageErrors.forEach(ctx.err);
      const lookOut: string[] = [];
      lookCode = await lookCommand.run({ ...ctx, json: true, fields: null, out: (line) => lookOut.push(line) }, [], {
        changed: true,
        phase,
      });
      lookReport = JSON.parse(lookOut.join('\n'));
      if (!ctx.json) {
        const report = lookReport as {
          stills: { status: string; path: string; detail: string }[];
          inherited: { status: string; path: string; detail: string }[];
        };
        for (const item of report.stills.filter((item) => item.status === 'warning'))
          ctx.err(`warning ${item.path}: ${item.detail}`);
        for (const item of report.stills.filter((item) => item.status !== 'pass'))
          if (item.status !== 'warning') ctx.err(`${item.status} ${item.path}: ${item.detail}`);
        if (report.inherited.length > 0) {
          ctx.err('inherited:');
          for (const item of report.inherited) ctx.err(`${item.status} ${item.path}: ${item.detail}`);
        }
      }
    }
    const ok =
      gate.ok &&
      assetCode === EXIT.ok &&
      lookCode === EXIT.ok &&
      loadingErrors.length === 0 &&
      imageErrors.length === 0 &&
      playArea?.ok !== false &&
      prProblems.length === 0;
    if (ctx.json && (lookReport !== undefined || playArea !== undefined || typeof flags.body === 'string'))
      ctx.out(
        JSON.stringify({
          ...gate,
          ok,
          look: lookReport,
          loadingErrors,
          imageErrors,
          playArea,
          prototypeReview: typeof flags.body === 'string' ? { problems: prProblems } : undefined,
        }),
      );
    else printGate(ctx, { ...gate, ok, checks: gate.checks });
    if (assetCode !== EXIT.ok) {
      out.forEach(ctx.out);
      err.forEach(ctx.err);
    }
    return ok ? EXIT.ok : EXIT.failed;
  },
};
