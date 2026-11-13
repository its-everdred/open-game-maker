import type { ControlDecl, DesignDoc, EditorCommand, GameManifest } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { describe, expect, it } from 'vitest';

import { MemoryBaseDocSource, type BaseDocSource } from '../src/design/base-doc.js';
import { acquireLease } from '../src/design/lease.js';
import { answerReport, computeReport, getReport, onBuildTested, switchBranchBuild } from '../src/design/reapply.js';
import { snapshotAt } from '../src/design/snapshot.js';
import { appendTransaction, ensureMainBranch, insertBranch, StaleBaseRev } from '../src/design/store.js';
import { makeDeps } from './helpers.js';

const now = '2026-11-01T20:00:00.000Z';
const ids = {
  family: 'f_01K8Z6Y7X8P9Q0R1S2T3V4W5X6',
  creator: 'u_01K8Z6Y7X8P9Q0R1S2T3V4W5X7',
  game: 'g_01K8Z6Y7X8P9Q0R1S2T3V4W5X9',
  from: 'build_01K8Z6Y7X8P9Q0R1S2T3V4W5XA',
  to: 'build_01K8Z6Y7X8P9Q0R1S2T3V4W5XB',
  job: 'job_01K8Z6Y7X8P9Q0R1S2T3V4W5XC',
  branch2: 'b_01K8Z6Y7X8P9Q0R1S2T3V4W5XD',
  branch3: 'b_01K8Z6Y7X8P9Q0R1S2T3V4W5XF',
  tx: 'tx_01K8Z6Y7X8P9Q0R1S2T3V4W5XE',
} as const;

function control(): ControlDecl {
  return {
    id: 'world.gravity',
    label: 'Gravity',
    scope: 'global',
    path: '/globals/world.gravity',
    widget: { kind: 'slider', min: 0, max: 10 },
    default: 1,
  };
}

function manifest(jobId?: string): GameManifest {
  return {
    id: 'fixture',
    sdk: '^1.0.0',
    title: 'Fixture',
    inputs: { actions: {} },
    presentation: { orientation: 'any', minLogical: { w: 320, h: 180 }, fit: 'responsive' },
    view: 'topdown',
    dimension: '2d',
    capabilities: [],
    palette: { categories: [], items: [] },
    tools: [],
    gizmos: {},
    saves: false,
    overrides: { aliases: {}, retired: [] },
    controls: [control()],
    ...(jobId ? { jobId } : {}),
  } as GameManifest;
}

function design(value: number): DesignDoc {
  return { schemaVersion: 1, globals: { 'world.gravity': value }, entities: {} };
}

function setup() {
  const deps = makeDeps();
  deps.db
    .insert(schema.families)
    .values({ id: ids.family, name: 'Family', ownerUserId: ids.creator, createdAt: now })
    .run();
  deps.db
    .insert(schema.games)
    .values({
      id: ids.game,
      familyId: ids.family,
      ownerId: ids.creator,
      title: 'Game',
      visibility: 'private',
      repoVisibility: 'private',
      createdAt: now,
    })
    .run();
  deps.db
    .insert(schema.jobs)
    .values({
      id: ids.job,
      gameId: ids.game,
      branchId: 'main',
      familyId: ids.family,
      creatorId: ids.creator,
      kind: 'feature',
      complexity: 3,
      state: 'done',
      start: 'now',
      slot: 'edit',
      plan: JSON.stringify({
        title: 'Change gravity',
        summary: 'Change the gravity control',
        scope: { included: ['gravity'], excluded: [] },
        targetControls: ['world.gravity'],
        tickets: [{ key: 'T1', skills: [], dependsOn: [], acceptanceCriteria: ['gravity changes'] }],
      }),
      reservation: '{}',
      hardCapMicroUsd: 1,
      createdAt: now,
      updatedAt: now,
      terminalAt: now,
    })
    .run();
  const branch = ensureMainBranch(deps.sqlite, ids.game);
  deps.sqlite.prepare('UPDATE branches SET latest_build_id = ? WHERE id = ?').run(ids.from, branch.id);
  appendTransaction(
    deps.sqlite,
    {
      gameId: ids.game,
      branchId: branch.id,
      baseRev: 0,
      leaseToken: 0,
      actor: ids.creator,
      kind: 'system',
      label: 'Set gravity',
      baseBuildId: ids.from,
      commands: [{ op: 'set', control: 'world.gravity', targets: 'global', value: 2 }],
      patches: [{ op: 'replace', path: ['globals', 'world.gravity'], value: 2 }],
      inverse: [{ op: 'replace', path: ['globals', 'world.gravity'], value: 1 }],
    },
    { id: ids.tx, now: new Date(now) },
  );
  const source = new MemoryBaseDocSource()
    .set(ids.game, ids.from, design(1), manifest())
    .set(ids.game, ids.to, design(1), manifest(ids.job));
  return { deps, branch, source };
}

describe('design reapply service', () => {
  it('carries pre-build edits and the latest created entity pose into the first build', async () => {
    const { deps, branch, source } = setup();
    insertBranch(deps.sqlite, {
      ...branch,
      id: ids.branch2,
      name: 'new-game',
      gitRef: 'refs/heads/new-game',
      headRev: 0,
      latestBuildId: null,
    });
    const entityId = 'e_01BX5ZZKBKACTAV9WEVGEMMVRZ';
    const pose = { position: [4, 0, 3] };
    for (const [index, command] of [
      {
        op: 'invoke',
        command: 'entity.create',
        args: { entityId, parent: 'main', prefab: 'scenery:tree', props: { pose: { position: [0, 0, 0] } } },
      },
      { op: 'invoke', command: 'entity.transform', args: { entityId, pose } },
      { op: 'set', control: 'world.gravity', targets: 'global', value: 2 },
    ].entries()) {
      appendTransaction(deps.sqlite, {
        gameId: ids.game,
        branchId: ids.branch2,
        baseRev: index,
        leaseToken: 0,
        actor: ids.creator,
        kind: 'system',
        label: 'Edit',
        baseBuildId: ids.to,
        commands: [command as EditorCommand],
        patches: [],
        inverse: [],
      });
    }
    const toDoc = design(1);
    toDoc.entities['e_01BX5ZZKBKACTAV9WEVGEMMVRY'] = {
      id: 'e_01BX5ZZKBKACTAV9WEVGEMMVRY',
      prefab: 'player',
      level: 'main',
      origin: 'builder',
      props: {},
    };
    source.set(ids.game, ids.to, toDoc, manifest());
    const result = await computeReport(deps.sqlite, source, ids.branch2, ids.to);
    expect(result.rebased.entityOps[entityId]).toMatchObject({ kind: 'create', props: { pose } });
    expect(result.rebased.entries['world.gravity@global']).toMatchObject({ value: 2 });
    await switchBranchBuild(deps.sqlite, source, { ...branch, id: ids.branch2 }, ids.to, {
      actor: ids.creator,
      token: 0,
    });
    const before = await snapshotAt(deps.sqlite, source, ids.branch2, 3);
    const after = await snapshotAt(deps.sqlite, source, ids.branch2);
    expect(before.buildId).toBeNull();
    expect(after.doc.entities[entityId]?.props.pose).toEqual(pose);
  });
  it('computes, stores, and then returns the cached report', async () => {
    const { deps, branch, source } = setup();
    const report = await computeReport(deps.sqlite, source, branch.id, ids.to, { now: new Date(now) });
    expect(report.report.dropped).toEqual([{ key: 'world.gravity@global', reason: 'superseded_by_job' }]);
    const unavailable: BaseDocSource = {
      load: async () => Promise.reject(new Error('artifact unavailable')),
      manifest: async () => Promise.reject(new Error('artifact unavailable')),
    };
    const cached = await getReport(deps.sqlite, unavailable, branch.id, ids.to);
    expect(cached).toEqual(report.report);
    expect(deps.sqlite.prepare('SELECT COUNT(*) FROM reapply_reports').pluck().get()).toBe(1);
  });

  it('precomputes reports for every active branch when a build is tested', async () => {
    const { deps, branch, source } = setup();
    insertBranch(deps.sqlite, {
      ...branch,
      id: ids.branch2,
      name: 'alternate',
      gitRef: 'refs/heads/alternate',
      headRev: 0,
      latestBuildId: ids.from,
    });
    insertBranch(deps.sqlite, {
      ...branch,
      id: ids.branch3,
      name: 'empty',
      gitRef: 'refs/heads/empty',
      headRev: 0,
      latestBuildId: null,
    });
    await onBuildTested(deps.sqlite, source, ids.to, ids.game, { now: new Date(now) });
    expect(deps.sqlite.prepare('SELECT COUNT(*) FROM reapply_reports').pluck().get()).toBe(3);
  });

  it('does not store a report when the destination manifest is invalid', async () => {
    const { deps, branch, source } = setup();
    const invalid: BaseDocSource = {
      load: source.load.bind(source),
      manifest: async () => ({ overrides: { aliases: {}, retired: [] } }) as GameManifest,
    };
    await expect(computeReport(deps.sqlite, invalid, branch.id, ids.to)).rejects.toThrow();
    expect(deps.sqlite.prepare('SELECT COUNT(*) FROM reapply_reports').pluck().get()).toBe(0);
  });

  it('invalidates a cached report whenever the branch log changes', async () => {
    const { deps, branch, source } = setup();
    await getReport(deps.sqlite, source, branch.id, ids.to);
    expect(deps.sqlite.prepare('SELECT COUNT(*) FROM reapply_reports').pluck().get()).toBe(1);

    appendTransaction(deps.sqlite, {
      gameId: ids.game,
      branchId: branch.id,
      baseRev: 1,
      leaseToken: 0,
      actor: ids.creator,
      kind: 'system',
      label: 'Change gravity again',
      baseBuildId: ids.from,
      commands: [{ op: 'set', control: 'world.gravity', targets: 'global', value: 3 }],
      patches: [{ op: 'replace', path: ['globals', 'world.gravity'], value: 3 }],
      inverse: [{ op: 'replace', path: ['globals', 'world.gravity'], value: 2 }],
    });

    expect(deps.sqlite.prepare('SELECT COUNT(*) FROM reapply_reports').pluck().get()).toBe(0);
  });

  it('does not store a report computed across a concurrent branch change', async () => {
    const { deps, branch, source } = setup();
    let changed = false;
    const racingSource: BaseDocSource = {
      load: async (gameId, buildId) => {
        if (!changed) {
          changed = true;
          appendTransaction(deps.sqlite, {
            gameId: ids.game,
            branchId: branch.id,
            baseRev: 1,
            leaseToken: 0,
            actor: ids.creator,
            kind: 'system',
            label: 'Concurrent edit',
            baseBuildId: ids.from,
            commands: [],
            patches: [],
            inverse: [],
          });
        }
        return source.load(gameId, buildId);
      },
      manifest: source.manifest.bind(source),
    };

    await expect(computeReport(deps.sqlite, racingSource, branch.id, ids.to)).rejects.toBeInstanceOf(StaleBaseRev);
    expect(deps.sqlite.prepare('SELECT COUNT(*) FROM reapply_reports').pluck().get()).toBe(0);
  });

  it('rejects an answer when the branch changes while its report is being resolved', async () => {
    const { deps, branch, source } = setup();
    appendTransaction(deps.sqlite, {
      gameId: ids.game,
      branchId: branch.id,
      baseRev: 1,
      leaseToken: 0,
      actor: ids.creator,
      kind: 'system',
      label: 'Set invalid gravity',
      baseBuildId: ids.from,
      commands: [{ op: 'set', control: 'world.gravity', targets: 'global', value: 15 }],
      patches: [{ op: 'replace', path: ['globals', 'world.gravity'], value: 15 }],
      inverse: [{ op: 'replace', path: ['globals', 'world.gravity'], value: 2 }],
    });
    await getReport(deps.sqlite, source, branch.id, ids.to);
    const lease = acquireLease(deps.sqlite, {
      gameId: ids.game,
      branchId: branch.id,
      userId: ids.creator,
      sessionId: 'browser-one',
    });
    let changed = false;
    const racingSource: BaseDocSource = {
      load: async (gameId, buildId) => {
        if (!changed) {
          changed = true;
          appendTransaction(deps.sqlite, {
            gameId: ids.game,
            branchId: branch.id,
            baseRev: 2,
            leaseToken: 0,
            actor: ids.creator,
            kind: 'system',
            label: 'Concurrent edit',
            baseBuildId: ids.from,
            commands: [],
            patches: [],
            inverse: [],
          });
        }
        return source.load(gameId, buildId);
      },
      manifest: source.manifest.bind(source),
    };

    await expect(
      answerReport(
        deps.sqlite,
        racingSource,
        branch,
        ids.to,
        [{ key: 'world.gravity@global', choice: 'use_allowed' }],
        { actor: ids.creator, sessionId: 'browser-one', token: lease.token },
      ),
    ).rejects.toBeInstanceOf(StaleBaseRev);
    expect(deps.sqlite.prepare('SELECT COUNT(*) FROM design_transactions').pluck().get()).toBe(3);
  });

  it('records resets for overrides that the switched build supersedes', async () => {
    const { deps, branch, source } = setup();
    const lease = acquireLease(deps.sqlite, {
      gameId: ids.game,
      branchId: branch.id,
      userId: ids.creator,
      sessionId: 'browser-one',
    });
    const switched = await switchBranchBuild(deps.sqlite, source, branch, ids.to, {
      actor: ids.creator,
      sessionId: 'browser-one',
      token: lease.token,
    });

    expect(switched.transaction.commands).toContainEqual({
      op: 'reset',
      control: 'world.gravity',
      targets: 'global',
    });
    expect(deps.sqlite.prepare('SELECT COUNT(*) FROM reapply_reports').pluck().get()).toBe(1);
  });

  it('preserves a renamed pending choice in the append-only log after switching', async () => {
    const { deps, branch, source } = setup();
    const renamedControl = {
      ...control(),
      id: 'world.force',
      label: 'Force',
      path: '/globals/world.force',
    } satisfies ControlDecl;
    source.set(ids.game, ids.to, { schemaVersion: 1, globals: { 'world.force': 4 }, entities: {} }, {
      ...manifest(),
      overrides: { aliases: { 'world.gravity': 'world.force' }, retired: [] },
      controls: [renamedControl],
    } as GameManifest);
    appendTransaction(deps.sqlite, {
      gameId: ids.game,
      branchId: branch.id,
      baseRev: 1,
      leaseToken: 0,
      actor: ids.creator,
      kind: 'system',
      label: 'Set invalid gravity',
      baseBuildId: ids.from,
      commands: [{ op: 'set', control: 'world.gravity', targets: 'global', value: 15 }],
      patches: [{ op: 'replace', path: ['globals', 'world.gravity'], value: 15 }],
      inverse: [{ op: 'replace', path: ['globals', 'world.gravity'], value: 2 }],
    });
    const lease = acquireLease(deps.sqlite, {
      gameId: ids.game,
      branchId: branch.id,
      userId: ids.creator,
      sessionId: 'browser-one',
    });
    const switched = await switchBranchBuild(deps.sqlite, source, branch, ids.to, {
      actor: ids.creator,
      sessionId: 'browser-one',
      token: lease.token,
    });
    expect(switched.transaction.commands).toEqual(
      expect.arrayContaining([
        { op: 'reset', control: 'world.gravity', targets: 'global' },
        { op: 'set', control: 'world.force', targets: 'global', value: 15 },
      ]),
    );
    expect(switched.transaction.patches).toEqual([]);

    appendTransaction(deps.sqlite, {
      gameId: ids.game,
      branchId: branch.id,
      baseRev: switched.transaction.rev,
      leaseToken: 0,
      actor: ids.creator,
      kind: 'system',
      label: 'Invalidate report cache',
      baseBuildId: ids.to,
      commands: [],
      patches: [],
      inverse: [],
    });
    await expect(getReport(deps.sqlite, source, branch.id, ids.to)).resolves.toMatchObject({
      needsChoice: [{ key: 'world.force@global', mine: 15, allowed: 10 }],
    });
  });

  it('does not resurrect an entity operation dropped by an earlier build switch', async () => {
    const { deps, branch, source } = setup();
    const entityId = 'e_01K8Z6Y7X8P9Q0R1S2T3V4W5XG';
    const laterBuild = 'build_01K8Z6Y7X8P9Q0R1S2T3V4W5XH';
    appendTransaction(deps.sqlite, {
      gameId: ids.game,
      branchId: branch.id,
      baseRev: 1,
      leaseToken: 0,
      actor: ids.creator,
      kind: 'system',
      label: 'Create platform',
      baseBuildId: ids.from,
      commands: [
        {
          op: 'invoke',
          command: 'entity.create',
          args: { entityId, parent: 'level_removed', prefab: 'platform', props: {} },
        },
      ],
      patches: [],
      inverse: [],
    });
    const lease = acquireLease(deps.sqlite, {
      gameId: ids.game,
      branchId: branch.id,
      userId: ids.creator,
      sessionId: 'browser-one',
    });
    await switchBranchBuild(deps.sqlite, source, branch, ids.to, {
      actor: ids.creator,
      sessionId: 'browser-one',
      token: lease.token,
    });
    source.set(
      ids.game,
      laterBuild,
      {
        schemaVersion: 1,
        globals: { 'world.gravity': 1 },
        entities: {
          e_anchor: { id: 'e_anchor', prefab: 'anchor', level: 'level_removed', origin: 'build', props: {} },
        },
      },
      manifest(),
    );

    const report = await computeReport(deps.sqlite, source, branch.id, laterBuild);
    expect(report.rebased.entityOps).not.toHaveProperty(entityId);
  });
});
