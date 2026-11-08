import type { Build, ChangeNote, Release } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { fold, reduce, type VersionCounts } from '@ogm/design-log';
import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';

import type { AppDeps } from '../app/types.js';
import type { BaseDocSource } from '../design/base-doc.js';
import { readChain, stableId } from '../design/store.js';
import { scanBuild } from '../gameplay/paid-integrations.js';
import { paidApisDuringGameplay } from '../gameplay/policy.js';
import type { CommitClient } from './commit-client.js';
import { ReleaseError } from './errors.js';
import {
  affectedSaves,
  type Changelog,
  preparePublish,
  releaseVersion,
  requireGameBranch,
  requireMainBuild,
  requireRollbackTarget,
} from './preview.js';
import { withPublishLock } from './publish-lock.js';
import type { RightsReason } from './rights.js';

type BuildRow = typeof schema.builds.$inferSelect;
type ReleaseRow = typeof schema.releases.$inferSelect;
type SnapshotRow = typeof schema.overrideSnapshots.$inferSelect;

export type ReleaseRuntime = {
  source: BaseDocSource;
  commit: CommitClient;
  checkRights: (artifactPath: string, visibility: 'public' | 'private') => Promise<RightsReason[]>;
  countSavesAboveSchema: (gameId: string, schemaVersion: number) => Promise<number | null>;
  deriveVersion: (counts: VersionCounts) => string;
  onBuildTested: (gameId: string, branchId: string, buildId: string) => Promise<void>;
  gamesOrigin: string;
  now: () => Date;
};

export { ReleaseError } from './errors.js';

export function buildResponse(row: BuildRow): Build {
  return {
    id: row.id,
    gameId: row.gameId,
    branchId: row.branchId,
    gitSha: row.gitSha,
    ...(row.jobId ? { jobId: row.jobId } : {}),
    sdkVersion: row.sdkVersion,
    saveSchemaVersion: row.saveSchemaVersion,
    ...(row.migratesFromSchema === null ? {} : { migratesFromSchema: row.migratesFromSchema }),
    achievementCatalogHash: row.achievementCatalogHash,
    status: row.status,
    artifact: row.artifact,
    createdAt: row.createdAt,
  };
}

// A release tag is the game's folder name plus the version: `<slug>/v<version>`. Rows written before slugs existed keep
// their game id, which is still a valid ref segment.
function releaseSlug(game: { slug: string | null; id: string }): string {
  return game.slug ?? game.id;
}

function releaseResponse(row: ReleaseRow): Release {
  return {
    id: row.id,
    gameId: row.gameId,
    seq: row.seq,
    version: row.version,
    buildId: row.buildId,
    snapshotId: row.snapshotId,
    gitTag: row.gitTag,
    kind: row.kind,
    ...(row.restoresReleaseId ? { restoresReleaseId: row.restoresReleaseId } : {}),
    ...(row.predecessorReleaseId ? { predecessorReleaseId: row.predecessorReleaseId } : {}),
    changelog: JSON.parse(row.changelogJson) as Changelog,
    publishedBy: row.publishedBy,
    publishedAt: row.publishedAt,
  };
}

function renderChangelog(changelog: Changelog): string {
  return `${changelog.summary}\n\n${changelog.items.map((item) => `- ${item.text}`).join('\n')}`.trim();
}

export function registerBuild(
  deps: AppDeps,
  runtime: ReleaseRuntime,
  gameId: string,
  input: Omit<typeof schema.builds.$inferInsert, 'id' | 'gameId' | 'status' | 'artifact' | 'createdAt'> & {
    changeNotes?: ChangeNote[];
  },
): Build {
  requireGameBranch(deps, gameId, input.branchId);
  const createdAt = runtime.now().toISOString();
  const build: typeof schema.builds.$inferInsert = {
    id: stableId('build', runtime.now()),
    gameId,
    branchId: input.branchId,
    gitSha: input.gitSha,
    jobId: input.jobId,
    sdkVersion: input.sdkVersion,
    saveSchemaVersion: input.saveSchemaVersion,
    migratesFromSchema: input.migratesFromSchema,
    achievementCatalogHash: input.achievementCatalogHash,
    status: 'building',
    artifact: 'present',
    artifactPath: input.artifactPath,
    createdAt,
  };
  deps.db.transaction((tx) => {
    tx.insert(schema.builds).values(build).run();
    if (input.changeNotes?.length) {
      tx.insert(schema.changeNotes)
        .values(
          input.changeNotes.map((note) => ({
            id: stableId('note', runtime.now()),
            gameId,
            jobId: note.jobId ?? input.jobId,
            txId: note.txId,
            kind: note.kind,
            text: note.text,
            createdAt,
          })),
        )
        .run();
    }
  });
  return buildResponse(build as BuildRow);
}

export async function updateBuild(
  deps: AppDeps,
  runtime: ReleaseRuntime,
  buildId: string,
  status: BuildRow['status'],
): Promise<Build> {
  const existing = deps.db.select().from(schema.builds).where(eq(schema.builds.id, buildId)).get();
  if (!existing) throw new ReleaseError('build_not_found', 404);
  deps.db.update(schema.builds).set({ status }).where(eq(schema.builds.id, buildId)).run();
  if (status === 'tested') {
    deps.sqlite
      .prepare("UPDATE branches SET latest_build_id = ? WHERE id = ? AND name = 'main' AND latest_build_id IS NULL")
      .run(buildId, existing.branchId);
    await runtime.onBuildTested(existing.gameId, existing.branchId, buildId);
  }
  return buildResponse({ ...existing, status });
}

async function prepareSnapshot(deps: AppDeps, runtime: ReleaseRuntime, build: BuildRow): Promise<SnapshotRow> {
  const baseDoc = await runtime.source.load(build.gameId, build.id);
  const chain = readChain(deps.sqlite, build.branchId);
  const transactions = chain.flatMap(({ txs }) => txs).filter((tx) => tx.branchId === build.branchId);
  const workingSet = reduce({
    gameId: build.gameId,
    branchId: build.branchId,
    buildId: build.id,
    baseDoc,
    txs: transactions,
  });
  const folded = fold(baseDoc, workingSet);
  const sameContent = and(
    eq(schema.overrideSnapshots.gameId, build.gameId),
    eq(schema.overrideSnapshots.buildId, build.id),
    eq(schema.overrideSnapshots.sha256, folded.sha256),
  );
  let snapshot = deps.db
    .select()
    .from(schema.overrideSnapshots)
    .where(and(sameContent, eq(schema.overrideSnapshots.headRev, workingSet.headRev)))
    .get();
  if (!snapshot) {
    /* Same effective design at a later revision: a new snapshot (so the changelog boundary advances) reusing the fold. */
    const sibling = deps.db
      .select({ foldSha: schema.overrideSnapshots.foldSha })
      .from(schema.overrideSnapshots)
      .where(and(sameContent, isNotNull(schema.overrideSnapshots.foldSha)))
      .get();
    snapshot = {
      id: stableId('snap', runtime.now()),
      gameId: build.gameId,
      branchId: build.branchId,
      buildId: build.id,
      headRev: workingSet.headRev,
      sha256: folded.sha256,
      entriesJson: JSON.stringify(
        Object.values(workingSet.entries).sort((left, right) => left.key.localeCompare(right.key)),
      ),
      entityOpsJson: JSON.stringify(
        Object.values(workingSet.entityOps).sort((left, right) => left.entityId.localeCompare(right.entityId)),
      ),
      foldSha: sibling?.foldSha ?? null,
      createdAt: runtime.now().toISOString(),
    };
    deps.db.insert(schema.overrideSnapshots).values(snapshot).run();
  }
  if (snapshot.foldSha) return snapshot;
  const result = await runtime.commit.execute({
    kind: 'fold_design',
    gameId: build.gameId,
    base: build.gitSha,
    files: folded.files,
  });
  if (!result.ok) throw new ReleaseError('gate_refused', 403, { verdict: result.verdict });
  deps.db
    .update(schema.overrideSnapshots)
    .set({ foldSha: result.sha })
    .where(eq(schema.overrideSnapshots.id, snapshot.id))
    .run();
  return { ...snapshot, foldSha: result.sha };
}

function appendRelease(
  deps: AppDeps,
  runtime: ReleaseRuntime,
  input: {
    gameId: string;
    expected: string | null;
    version: string;
    buildId: string;
    snapshotId: string;
    kind: 'publish' | 'rollback';
    restoresReleaseId?: string;
    changelog: Changelog;
    actor: string;
    noteIds?: string[];
    // The game's folder name under games/, so tags read `<slug>/v<version>` and never collide across games.
    slug: string;
  },
): ReleaseRow {
  return deps.sqlite
    .transaction(() => {
      const current = deps.sqlite
        .prepare<[string], { published_release_id: string | null }>(
          'SELECT published_release_id FROM games WHERE id = ?',
        )
        .get(input.gameId);
      if (!current || current.published_release_id !== input.expected) throw new ReleaseError('pointer_moved', 409);
      const seq =
        (deps.sqlite
          .prepare<[string], { seq: number | null }>('SELECT MAX(seq) AS seq FROM releases WHERE game_id = ?')
          .get(input.gameId)?.seq ?? 0) + 1;
      const artifact = deps.sqlite
        .prepare<[string], { artifact: BuildRow['artifact'] }>('SELECT artifact FROM builds WHERE id = ?')
        .get(input.buildId)?.artifact;
      if (artifact !== 'present') throw new ReleaseError('artifact_missing', 409);
      const row: ReleaseRow = {
        id: stableId('rel', runtime.now()),
        gameId: input.gameId,
        seq,
        version: input.version,
        buildId: input.buildId,
        snapshotId: input.snapshotId,
        gitTag: `${input.slug}/v${input.version}`,
        kind: input.kind,
        restoresReleaseId: input.restoresReleaseId ?? null,
        predecessorReleaseId: input.expected,
        changelogJson: JSON.stringify(input.changelog),
        publishedBy: input.actor,
        publishedAt: runtime.now().toISOString(),
      };
      deps.db.insert(schema.releases).values(row).run();
      const moved = deps.sqlite
        .prepare('UPDATE games SET published_release_id = ? WHERE id = ? AND published_release_id IS ?')
        .run(row.id, input.gameId, input.expected);
      if (moved.changes === 0) throw new ReleaseError('pointer_moved', 409);
      if (input.kind === 'publish' && input.noteIds?.length) {
        deps.db
          .update(schema.changeNotes)
          .set({ releaseId: row.id })
          .where(
            and(
              eq(schema.changeNotes.gameId, input.gameId),
              inArray(schema.changeNotes.id, input.noteIds),
              isNull(schema.changeNotes.releaseId),
            ),
          )
          .run();
      }
      return row;
    })
    .immediate();
}

// A release is what players run: it holds no provider credential, and names no paid provider while paid APIs during
// gameplay are off (a build ingested while they were on is refused once they are off).
async function requireGameplayCompliant(deps: AppDeps, artifactPath: string): Promise<void> {
  const integrations = await scanBuild(artifactPath);
  if (integrations.credentials.length > 0) throw new ReleaseError('provider_credential', 422);
  if (integrations.paid.length > 0 && !paidApisDuringGameplay(deps.db)) throw new ReleaseError('paid_integration', 422);
}

export async function publish(
  deps: AppDeps,
  runtime: ReleaseRuntime,
  input: { gameId: string; buildId: string; actor: string; changelog?: Changelog },
): Promise<Release> {
  const { build, game } = requireMainBuild(deps, input.gameId, input.buildId);
  const expected = game.publishedReleaseId;
  await requireGameplayCompliant(deps, build.artifactPath);
  const rights = await runtime.checkRights(build.artifactPath, game.repoVisibility);
  if (rights.length) throw new ReleaseError('rights', 422, { rights });
  return withPublishLock(deps, input.gameId, async () => {
    const current = deps.db
      .select({ publishedReleaseId: schema.games.publishedReleaseId })
      .from(schema.games)
      .where(eq(schema.games.id, input.gameId))
      .get();
    if (!current || current.publishedReleaseId !== expected) throw new ReleaseError('pointer_moved', 409);

    const snapshot = await prepareSnapshot(deps, runtime, build);
    const { version, prepared } = await preparePublish(deps, runtime, input.gameId, input.changelog);
    const result = await runtime.commit.execute({
      kind: 'release',
      gameId: input.gameId,
      sha: snapshot.foldSha!,
      semver: version,
      changelog: renderChangelog(prepared.changelog),
    });
    if (!result.ok) throw new ReleaseError('gate_refused', 403, { verdict: result.verdict });
    return releaseResponse(
      appendRelease(deps, runtime, {
        gameId: input.gameId,
        expected,
        version,
        buildId: build.id,
        snapshotId: snapshot.id,
        kind: 'publish',
        changelog: prepared.changelog,
        noteIds: prepared.noteIds,
        actor: input.actor,
        slug: releaseSlug(game),
      }),
    );
  });
}

export async function rollback(
  deps: AppDeps,
  runtime: ReleaseRuntime,
  input: { gameId: string; releaseId: string; actor: string },
): Promise<Release & { affectedSaves: number | null }> {
  const { game, target, snapshot, build } = requireRollbackTarget(deps, input.gameId, input.releaseId);
  /* Paid APIs may have been turned off, and the repo may have gone public, since the restored release was checked. */
  await requireGameplayCompliant(deps, build.artifactPath);
  const rights = await runtime.checkRights(build.artifactPath, game.repoVisibility);
  if (rights.length) throw new ReleaseError('rights', 422, { rights });
  const foldSha = snapshot.foldSha;
  const expected = game.publishedReleaseId;
  return withPublishLock(deps, input.gameId, async () => {
    const current = deps.db
      .select({ publishedReleaseId: schema.games.publishedReleaseId })
      .from(schema.games)
      .where(eq(schema.games.id, input.gameId))
      .get();
    if (!current || current.publishedReleaseId !== expected) throw new ReleaseError('pointer_moved', 409);

    const saves = await affectedSaves(runtime, input.gameId, build);
    const version = await releaseVersion(deps, runtime, input.gameId);
    const changelog = { summary: `Restores ${target.version}`, items: [] };
    /* Restoring rewrites only this game's folder on main; the tag then points at the commit that did it. */
    const restored = await runtime.commit.execute({
      kind: 'restore_game',
      gameId: input.gameId,
      sha: foldSha,
    });
    if (!restored.ok) throw new ReleaseError('gate_refused', 403, { verdict: restored.verdict });
    const result = await runtime.commit.execute({
      kind: 'release',
      gameId: input.gameId,
      sha: restored.sha,
      semver: version,
      changelog: changelog.summary,
    });
    if (!result.ok) throw new ReleaseError('gate_refused', 403, { verdict: result.verdict });
    const row = appendRelease(deps, runtime, {
      gameId: input.gameId,
      expected,
      version,
      buildId: target.buildId,
      snapshotId: target.snapshotId,
      kind: 'rollback',
      restoresReleaseId: target.id,
      changelog,
      actor: input.actor,
      slug: releaseSlug(game),
    });
    return {
      ...releaseResponse(row),
      affectedSaves: saves,
    };
  });
}

export function listReleases(deps: AppDeps, gameId: string): Release[] {
  return deps.db
    .select()
    .from(schema.releases)
    .where(eq(schema.releases.gameId, gameId))
    .orderBy(schema.releases.seq)
    .all()
    .map(releaseResponse);
}

export function published(deps: AppDeps, gameId: string) {
  const game = deps.db.select().from(schema.games).where(eq(schema.games.id, gameId)).get();
  if (!game?.publishedReleaseId) throw new ReleaseError('not_published', 404);
  const release = deps.db.select().from(schema.releases).where(eq(schema.releases.id, game.publishedReleaseId)).get();
  if (!release) throw new ReleaseError('not_published', 404);
  return releaseResponse(release);
}

export function addChangeNote(
  deps: AppDeps,
  runtime: ReleaseRuntime,
  input: { gameId: string; jobId: string; kind: ChangeNote['kind']; text: string },
): ChangeNote {
  const note = { id: stableId('note', runtime.now()), ...input, createdAt: runtime.now().toISOString() };
  deps.db.insert(schema.changeNotes).values(note).run();
  return { jobId: input.jobId, kind: input.kind, text: input.text };
}

export function listBuilds(deps: AppDeps, gameId: string): Build[] {
  return deps.db
    .select()
    .from(schema.builds)
    .where(eq(schema.builds.gameId, gameId))
    .orderBy(asc(schema.builds.createdAt), asc(schema.builds.id))
    .all()
    .map(buildResponse);
}
