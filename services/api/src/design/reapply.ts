import {
  gameManifestSchema,
  ReapplyReportSchema,
  type Branch,
  type DesignDoc,
  type EditorCommand,
  type GameManifest,
  type OverrideKey,
  type Patch,
  type ReapplyReport,
  type Transaction,
} from '@ogm/contracts';
import type { Sqlite } from '@ogm/db';
import { reduce, reapply, type ReapplyResult } from '@ogm/design-log';

import type { BaseDocSource } from './base-doc.js';
import { EMPTY_BUILD_ID } from './snapshot.js';
import { appendBuildSwitch, appendTransaction, readChain, StaleBaseRev } from './store.js';

type ReportRow = {
  report_json: string;
};

export class ManifestInvalid extends Error {
  readonly buildId: string;

  constructor(buildId: string, cause: unknown) {
    super(`manifest is invalid for build ${buildId}`, { cause });
    this.name = 'ManifestInvalid';
    this.buildId = buildId;
  }
}

export class BuildNotFound extends Error {
  constructor(buildId: string) {
    super(`build not found: ${buildId}`);
    this.name = 'BuildNotFound';
  }
}

export class AnswerConflict extends Error {
  constructor() {
    super('answer does not match an unresolved report item');
    this.name = 'AnswerConflict';
  }
}

export class BuildNotTested extends Error {
  constructor(buildId: string) {
    super(`build is not tested: ${buildId}`);
    this.name = 'BuildNotTested';
  }
}

export type ReapplyAnswer = {
  key: OverrideKey;
  choice: 'use_allowed' | 'keep_mine' | 'discard' | 'use_builder';
};
// A system switch (the build publisher) has no session: it writes as `system` with lease token 0.
export type ReapplyLease = { actor: string; sessionId?: string; token: number };

function parseManifest(buildId: string, value: unknown): GameManifest {
  try {
    return gameManifestSchema.parse(value);
  } catch (error) {
    throw new ManifestInvalid(buildId, error);
  }
}

async function loadManifest(source: BaseDocSource, gameId: string, buildId: string): Promise<GameManifest> {
  try {
    return parseManifest(buildId, await source.manifest(gameId, buildId));
  } catch (error) {
    if (error instanceof ManifestInvalid) throw error;
    throw new ManifestInvalid(buildId, error);
  }
}

function effectiveTransactions(chain: ReturnType<typeof readChain>): Transaction[] {
  const leaf = chain.at(-1)?.branch;
  if (!leaf) return [];
  let revision = 0;
  const effective: Transaction[] = [];
  chain.forEach((segment, index) => {
    const child = chain[index + 1];
    const limit = child?.branch.forkPoint?.parentRev ?? segment.branch.headRev;
    for (const transaction of segment.txs) {
      if (transaction.rev > limit) break;
      revision += 1;
      effective.push({ ...transaction, branchId: leaf.id, rev: revision, baseRev: revision - 1 });
    }
  });
  return effective;
}

function targetControls(sqlite: Sqlite, manifest: GameManifest): string[] {
  const jobId = (manifest as Record<string, unknown>).jobId;
  if (typeof jobId !== 'string') return [];
  const row = sqlite.prepare<[string], { plan: string }>('SELECT plan FROM jobs WHERE id = ?').get(jobId);
  if (!row) return [];
  try {
    const plan = JSON.parse(row.plan) as { targetControls?: unknown };
    return Array.isArray(plan.targetControls)
      ? plan.targetControls.filter((control): control is string => typeof control === 'string')
      : [];
  } catch {
    return [];
  }
}

function storeReport(sqlite: Sqlite, result: ReapplyResult, now: Date): void {
  sqlite
    .prepare(
      `INSERT INTO reapply_reports
         (game_id, branch_id, from_build_id, to_build_id, report_json, computed_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(branch_id, to_build_id) DO UPDATE SET
         game_id = excluded.game_id,
         from_build_id = excluded.from_build_id,
         report_json = excluded.report_json,
         computed_at = excluded.computed_at`,
    )
    .run(
      result.report.gameId,
      result.report.branchId,
      result.report.fromBuildId,
      result.report.toBuildId,
      JSON.stringify(result.report),
      now.toISOString(),
    );
}

function storeComputedReport(sqlite: Sqlite, result: ReapplyResult, now: Date, branch: Branch): void {
  sqlite
    .transaction(() => {
      const current = sqlite
        .prepare<[string], { head_rev: number; latest_build_id: string | null }>(
          'SELECT head_rev, latest_build_id FROM branches WHERE id = ?',
        )
        .get(branch.id);
      if (!current || current.head_rev !== branch.headRev || current.latest_build_id !== branch.latestBuildId) {
        throw new StaleBaseRev(current?.head_rev ?? branch.headRev);
      }
      storeReport(sqlite, result, now);
    })
    .immediate();
}

export async function computeReport(
  sqlite: Sqlite,
  source: BaseDocSource,
  branchId: string,
  toBuildId: string,
  options: { now?: Date } = {},
): Promise<ReapplyResult> {
  const chain = readChain(sqlite, branchId);
  const branch = chain.at(-1)?.branch;
  if (!branch) throw new Error('design branch has no replay chain');
  if (!branch.latestBuildId) {
    const [toDoc, toManifest] = await Promise.all([
      source.load(branch.gameId, toBuildId),
      loadManifest(source, branch.gameId, toBuildId),
    ]);
    const result = reapply({
      from: { buildId: EMPTY_BUILD_ID, baseDoc: toDoc, manifest: toManifest },
      to: { buildId: toBuildId, baseDoc: toDoc, manifest: toManifest },
      workingSet: reduce({
        gameId: branch.gameId,
        branchId: branch.id,
        buildId: toBuildId,
        baseDoc: toDoc,
        txs: effectiveTransactions(chain),
      }),
      targetControls: targetControls(sqlite, toManifest),
    });
    storeComputedReport(sqlite, result, options.now ?? new Date(), branch);
    return result;
  }
  const fromBuildId = branch.latestBuildId;
  const [fromDoc, toDoc, fromManifest, toManifest] = await Promise.all([
    source.load(branch.gameId, fromBuildId),
    source.load(branch.gameId, toBuildId),
    loadManifest(source, branch.gameId, fromBuildId),
    loadManifest(source, branch.gameId, toBuildId),
  ]);
  const transactions = effectiveTransactions(chain);
  const workingSet = reduce({
    gameId: branch.gameId,
    branchId: branch.id,
    buildId: fromBuildId,
    baseDoc: fromDoc,
    baseDocs: { [fromBuildId]: fromDoc, [toBuildId]: toDoc },
    txs: transactions,
  });
  const result = reapply({
    from: { buildId: fromBuildId, baseDoc: fromDoc, manifest: fromManifest },
    to: { buildId: toBuildId, baseDoc: toDoc, manifest: toManifest },
    workingSet,
    targetControls: targetControls(sqlite, toManifest),
  });
  storeComputedReport(sqlite, result, options.now ?? new Date(), branch);
  return result;
}

export async function getReport(
  sqlite: Sqlite,
  source: BaseDocSource,
  branchId: string,
  toBuildId: string,
): Promise<ReapplyReport> {
  const stored = sqlite
    .prepare<[string, string], ReportRow>(
      'SELECT report_json FROM reapply_reports WHERE branch_id = ? AND to_build_id = ?',
    )
    .get(branchId, toBuildId);
  if (stored) return ReapplyReportSchema.parse(JSON.parse(stored.report_json));
  return (await computeReport(sqlite, source, branchId, toBuildId)).report;
}

function gameForBuild(sqlite: Sqlite, buildId: string): string {
  const hasBuilds = sqlite
    .prepare<[], { found: number }>("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'builds'")
    .get();
  if (!hasBuilds) throw new BuildNotFound(buildId);
  const row = sqlite.prepare<[string], { game_id: string }>('SELECT game_id FROM builds WHERE id = ?').get(buildId);
  if (!row) throw new BuildNotFound(buildId);
  return row.game_id;
}

export async function onBuildTested(
  sqlite: Sqlite,
  source: BaseDocSource,
  buildId: string,
  gameId = gameForBuild(sqlite, buildId),
  options: { now?: Date } = {},
): Promise<void> {
  const branches = sqlite
    .prepare<[string, string], { id: string }>(
      `SELECT id FROM branches
       WHERE game_id = ? AND status = 'active' AND (latest_build_id IS NULL OR latest_build_id <> ?)`,
    )
    .all(gameId, buildId);
  await Promise.all(branches.map(async ({ id }) => computeReport(sqlite, source, id, buildId, options)));
}

function splitKey(key: OverrideKey): { controlId: string; targetId: string | 'global' } {
  const separator = key.lastIndexOf('@');
  return { controlId: key.slice(0, separator), targetId: key.slice(separator + 1) };
}

function targetsFor(targetId: string | 'global'): Extract<EditorCommand, { op: 'set' }>['targets'] {
  return targetId === 'global' ? 'global' : [targetId];
}

function valueAt(doc: DesignDoc, key: OverrideKey): unknown {
  const { controlId, targetId } = splitKey(key);
  return targetId === 'global' ? doc.globals[controlId] : doc.entities[targetId]?.props[controlId];
}

function patchForValue(doc: DesignDoc, key: OverrideKey, value: unknown): Patch {
  const { controlId, targetId } = splitKey(key);
  const path: Patch['path'] =
    targetId === 'global' ? ['globals', controlId] : ['entities', targetId, 'props', controlId];
  return { op: valueAt(doc, key) === undefined ? 'add' : 'replace', path, value };
}

export async function answerReport(
  sqlite: Sqlite,
  source: BaseDocSource,
  branch: Branch,
  toBuildId: string,
  answers: readonly ReapplyAnswer[],
  lease: ReapplyLease,
): Promise<Transaction[]> {
  const expectedBranch = readChain(sqlite, branch.id).at(-1)!.branch;
  const report = await getReport(sqlite, source, branch.id, toBuildId);
  const allowed = new Map(report.needsChoice.map((item) => [item.key, item]));
  const conflicts = new Map(report.conflicts.map((item) => [item.key, item]));
  const renamed = new Map(report.renamed.map((item) => [item.to, item.from]));
  const toDoc = await source.load(branch.gameId, toBuildId);
  const currentBranch = readChain(sqlite, branch.id).at(-1)!.branch;
  if (
    currentBranch.headRev !== expectedBranch.headRev ||
    currentBranch.latestBuildId !== expectedBranch.latestBuildId
  ) {
    throw new StaleBaseRev(currentBranch.headRev);
  }
  const answered = new Set<OverrideKey>();

  for (const answer of answers) {
    if (answered.has(answer.key)) throw new AnswerConflict();
    answered.add(answer.key);
    const needsChoice = allowed.get(answer.key);
    const conflict = conflicts.get(answer.key);
    const valid =
      (answer.choice === 'use_allowed' && needsChoice !== undefined) ||
      (answer.choice === 'keep_mine' && conflict !== undefined) ||
      (answer.choice === 'use_builder' && conflict !== undefined) ||
      (answer.choice === 'discard' && (needsChoice !== undefined || conflict !== undefined));
    if (!valid) throw new AnswerConflict();
  }

  const transactions: Transaction[] = [];
  let baseRev = currentBranch.headRev;
  for (const answer of answers) {
    const item = allowed.get(answer.key) ?? conflicts.get(answer.key)!;
    const { controlId, targetId } = splitKey(answer.key);
    const commands: EditorCommand[] = [];
    const oldKey = renamed.get(answer.key);
    if (oldKey) {
      const old = splitKey(oldKey);
      commands.push({ op: 'reset', control: old.controlId, targets: targetsFor(old.targetId) });
    }
    const usesMine = answer.choice === 'keep_mine';
    const usesAllowed = answer.choice === 'use_allowed';
    const value = usesAllowed && 'allowed' in item ? item.allowed : item.mine;
    const patches: Patch[] = [];
    const inverse: Patch[] = [];
    if (usesMine || usesAllowed) {
      commands.push({ op: 'set', control: controlId, targets: targetsFor(targetId), value });
      patches.push(patchForValue(toDoc, answer.key, value));
      const builder = valueAt(toDoc, answer.key);
      const path = patches[0]!.path;
      inverse.push(builder === undefined ? { op: 'remove', path } : { op: 'replace', path, value: builder });
    } else {
      commands.push({ op: 'reset', control: controlId, targets: targetsFor(targetId) });
      const builder = valueAt(toDoc, answer.key);
      const path = patchForValue(toDoc, answer.key, builder).path;
      if (builder === undefined) patches.push({ op: 'remove', path });
      else patches.push({ op: 'replace', path, value: builder });
      inverse.push({ op: 'replace', path, value: item.mine });
    }
    const transaction = appendTransaction(sqlite, {
      gameId: branch.gameId,
      branchId: branch.id,
      baseRev,
      leaseToken: lease.token,
      actor: lease.actor,
      kind: 'system',
      label: `Resolved ${controlId}`,
      baseBuildId: toBuildId,
      commands,
      patches,
      inverse,
      sessionId: lease.sessionId,
    });
    transactions.push(transaction);
    baseRev = transaction.rev;
  }
  return transactions;
}

function switchCommands(result: ReapplyResult): EditorCommand[] {
  const commands: EditorCommand[] = [
    {
      op: 'invoke',
      command: 'build.switch',
      args: { from: result.report.fromBuildId, to: result.report.toBuildId },
    },
  ];
  const resets = new Set<OverrideKey>([
    ...result.report.renamed.map(({ from }) => from),
    ...result.report.dropped.map(({ key }) => key),
  ]);
  for (const key of [...resets].sort()) {
    const { controlId, targetId } = splitKey(key);
    commands.push({ op: 'reset', control: controlId, targets: targetsFor(targetId) });
  }
  for (const operation of Object.values(result.rebased.entityOps).sort((left, right) =>
    left.entityId.localeCompare(right.entityId),
  )) {
    if (operation.kind === 'create') {
      commands.push({
        op: 'invoke',
        command: 'entity.create',
        args: {
          entityId: operation.entityId,
          parent: operation.parent,
          prefab: operation.prefab,
          props: operation.props,
        },
      });
    } else {
      commands.push({ op: 'invoke', command: 'entity.delete', args: { entityId: operation.entityId } });
    }
  }
  for (const entry of Object.values(result.rebased.entries).sort((left, right) => left.key.localeCompare(right.key))) {
    commands.push({ op: 'set', control: entry.controlId, targets: targetsFor(entry.targetId), value: entry.value });
  }
  return commands;
}

export async function switchBranchBuild(
  sqlite: Sqlite,
  source: BaseDocSource,
  branch: Branch,
  toBuildId: string,
  lease: ReapplyLease,
): Promise<{ transaction: Transaction; report: ReapplyReport }> {
  let status: Awaited<ReturnType<NonNullable<BaseDocSource['status']>>> | 'tested';
  try {
    status = (await source.status?.(branch.gameId, toBuildId)) ?? 'tested';
  } catch (error) {
    throw new ManifestInvalid(toBuildId, error);
  }
  if (status !== 'tested') throw new BuildNotTested(toBuildId);
  const result = await computeReport(sqlite, source, branch.id, toBuildId);
  const current = readChain(sqlite, branch.id).at(-1)!.branch;
  const manifest = await source.manifest(branch.gameId, toBuildId);
  const sequence = (manifest as Record<string, unknown>).seq;
  const label = typeof sequence === 'number' ? String(sequence) : toBuildId;
  const transaction = appendBuildSwitch(
    sqlite,
    {
      gameId: branch.gameId,
      branchId: branch.id,
      baseRev: current.headRev,
      leaseToken: lease.token,
      actor: lease.actor,
      kind: 'system',
      label: `Switched to build ${label}`,
      baseBuildId: toBuildId,
      commands: switchCommands(result),
      patches: result.switchPatches,
      inverse: result.switchInverse,
      sessionId: lease.sessionId,
    },
    toBuildId,
  );
  storeReport(sqlite, result, new Date());
  return { transaction, report: result.report };
}
