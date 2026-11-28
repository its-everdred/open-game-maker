import type { ChangeNote } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';

import type { AppDeps } from '../app/types.js';
import { ReleaseError } from './errors.js';
import type { ReleaseRuntime } from './service.js';
import { nextReleaseVersion } from './tag-reservations.js';

export type Changelog = { summary: string; items: ChangeNote[] };
export type PreparedChangelog = { changelog: Changelog; noteIds: string[] };
type BuildRow = typeof schema.builds.$inferSelect;

function requireBuild(deps: AppDeps, gameId: string, buildId: string): BuildRow {
  const build = deps.db
    .select()
    .from(schema.builds)
    .where(and(eq(schema.builds.id, buildId), eq(schema.builds.gameId, gameId)))
    .get();
  if (!build) throw new ReleaseError('build_not_found', 404);
  return build;
}

export function requireGameBranch(deps: AppDeps, gameId: string, branchId: string) {
  const branch = deps.db
    .select()
    .from(schema.branches)
    .where(and(eq(schema.branches.id, branchId), eq(schema.branches.gameId, gameId)))
    .get();
  if (!branch) throw new ReleaseError('branch_not_found', 404);
  return branch;
}

export function requireMainBuild(deps: AppDeps, gameId: string, buildId: string) {
  const build = requireBuild(deps, gameId, buildId);
  if (build.status !== 'tested') throw new ReleaseError('not_tested', 409);
  if (build.artifact !== 'present') throw new ReleaseError('artifact_missing', 409);
  if (requireGameBranch(deps, gameId, build.branchId).name !== 'main') throw new ReleaseError('not_main', 409);
  const game = deps.db.select().from(schema.games).where(eq(schema.games.id, gameId)).get();
  if (!game) throw new ReleaseError('game_not_found', 404);
  return { build, game };
}

export async function releaseVersion(deps: AppDeps, runtime: ReleaseRuntime, gameId: string): Promise<string> {
  return nextReleaseVersion(deps, runtime, gameId);
}

function lintText(text: string): string {
  const unsafe = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|(?:https?:\/\/|www\.)\S+|(^|\s)@[A-Z0-9_]+\b/i;
  return unsafe.test(text) ? '(edited)' : text.trim();
}

function assembleChangelog(deps: AppDeps, gameId: string): PreparedChangelog {
  const noteRows = deps.db
    .select()
    .from(schema.changeNotes)
    .where(and(eq(schema.changeNotes.gameId, gameId), isNull(schema.changeNotes.releaseId)))
    .orderBy(asc(schema.changeNotes.createdAt), asc(schema.changeNotes.id))
    .all();
  const notes = noteRows.map((note) => ({
    ...(note.jobId ? { jobId: note.jobId } : {}),
    ...(note.txId ? { txId: note.txId } : {}),
    kind: note.kind,
    text: lintText(note.text),
  }));
  const latestPublish = deps.db
    .select()
    .from(schema.releases)
    .where(and(eq(schema.releases.gameId, gameId), eq(schema.releases.kind, 'publish')))
    .orderBy(desc(schema.releases.seq))
    .get();
  const afterRev = latestPublish
    ? (deps.db
        .select({ headRev: schema.overrideSnapshots.headRev })
        .from(schema.overrideSnapshots)
        .where(eq(schema.overrideSnapshots.id, latestPublish.snapshotId))
        .get()?.headRev ?? 0)
    : 0;
  const labels = deps.sqlite
    .prepare<[string, number], { id: string; label: string }>(
      `SELECT tx.id, tx.label FROM design_transactions tx
       JOIN branches b ON b.id = tx.branch_id
       WHERE tx.game_id = ? AND b.name = 'main' AND tx.kind = 'manual' AND tx.rev > ? ORDER BY tx.rev`,
    )
    .all(gameId, afterRev)
    .map(({ id, label }) => ({ txId: id, kind: 'change' as const, text: lintText(label) }));
  const seen = new Set<string>();
  const items = [...notes, ...labels].filter(({ text }) => {
    const key = text.trim().toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    changelog: { summary: items[0]?.text ?? 'Updates', items },
    noteIds: noteRows.map(({ id }) => id),
  };
}

function sanitizeChangelog(changelog: Changelog): Changelog {
  return {
    summary: lintText(changelog.summary),
    items: changelog.items.map((item) => ({ ...item, text: lintText(item.text) })),
  };
}

export async function preparePublish(
  deps: AppDeps,
  runtime: ReleaseRuntime,
  gameId: string,
  changelog?: Changelog,
): Promise<{ version: string; prepared: PreparedChangelog }> {
  const prepared = changelog
    ? {
        changelog: sanitizeChangelog(changelog),
        noteIds: deps.db
          .select({ id: schema.changeNotes.id })
          .from(schema.changeNotes)
          .where(and(eq(schema.changeNotes.gameId, gameId), isNull(schema.changeNotes.releaseId)))
          .all()
          .map(({ id }) => id),
      }
    : assembleChangelog(deps, gameId);
  return { version: await releaseVersion(deps, runtime, gameId), prepared };
}

export async function publishPreview(
  deps: AppDeps,
  runtime: ReleaseRuntime,
  input: { gameId: string; buildId: string },
) {
  requireMainBuild(deps, input.gameId, input.buildId);
  const { version, prepared } = await preparePublish(deps, runtime, input.gameId);
  return { version, changelog: prepared.changelog };
}

export function requireRollbackTarget(deps: AppDeps, gameId: string, releaseId: string) {
  const game = deps.db.select().from(schema.games).where(eq(schema.games.id, gameId)).get();
  if (!game) throw new ReleaseError('game_not_found', 404);
  const target = deps.db
    .select()
    .from(schema.releases)
    .where(and(eq(schema.releases.id, releaseId), eq(schema.releases.gameId, gameId)))
    .get();
  if (!target) throw new ReleaseError('release_not_found', 404);
  const snapshot = deps.db
    .select()
    .from(schema.overrideSnapshots)
    .where(eq(schema.overrideSnapshots.id, target.snapshotId))
    .get();
  const build = deps.db.select().from(schema.builds).where(eq(schema.builds.id, target.buildId)).get();
  const foldSha = snapshot?.foldSha;
  if (!snapshot || !foldSha || !build) throw new ReleaseError('release_incomplete', 409);
  return { game, target, snapshot: { ...snapshot, foldSha }, build };
}

export async function affectedSaves(runtime: ReleaseRuntime, gameId: string, build: BuildRow): Promise<number | null> {
  return runtime.countSavesAboveSchema(gameId, build.saveSchemaVersion);
}

export async function rollbackPreview(
  deps: AppDeps,
  runtime: ReleaseRuntime,
  input: { gameId: string; releaseId: string },
) {
  const { build } = requireRollbackTarget(deps, input.gameId, input.releaseId);
  return { affectedSaves: await affectedSaves(runtime, input.gameId, build) };
}
