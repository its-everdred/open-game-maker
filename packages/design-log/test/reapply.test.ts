import { readFileSync } from 'node:fs';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { ControlDecl, DesignDoc, GameManifest, OverrideEntry, OverrideKey, WorkingSet } from '@ogm/contracts';

import { canonical } from '../src/canonical.js';
import { apply } from '../src/apply.js';
import { reapply } from '../src/reapply.js';
import { ids } from './helpers.js';

const nextBuild = 'build_01BX5ZZKBKACTAV9WEVGEMMVRZ';
const removedEntity = 'e_01BX5ZZKBKACTAV9WEVGEMMVRZ';
const createdEntity = 'e_01BX5ZZKBKACTAV9WEVGEMMVR0';

function control(id: string, options: { min?: number; max?: number; default?: number } = {}): ControlDecl {
  return {
    id,
    label: id,
    scope: 'global',
    path: `/globals/${id}`,
    widget: { kind: 'count', min: options.min ?? 0, max: options.max ?? 100, semantics: 'param' },
    default: options.default ?? 0,
  };
}

function manifest(
  controls: ControlDecl[],
  overrides: { aliases?: Record<string, string>; retired?: string[]; migrate?: string[] } = {},
): GameManifest {
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
    controls,
    overrides: {
      aliases: overrides.aliases ?? {},
      retired: overrides.retired ?? [],
      migrate: overrides.migrate ?? [],
    },
  } as GameManifest;
}

function doc(globals: Record<string, unknown> = {}, entities: DesignDoc['entities'] = {}): DesignDoc {
  return { schemaVersion: 1, globals, entities };
}

function entry(
  controlId: string,
  value: unknown,
  baseValueAtEdit: unknown,
  targetId: OverrideEntry['targetId'] = 'global',
): OverrideEntry {
  return {
    key: `${controlId}@${targetId}` as OverrideKey,
    controlId,
    targetId,
    value,
    baseValueAtEdit,
    txId: ids.tx,
    rev: 1,
    status: 'carried',
  };
}

function workingSet(entries: OverrideEntry[], entityOps: WorkingSet['entityOps'] = {}): WorkingSet {
  return {
    gameId: ids.game,
    branchId: ids.branch,
    buildId: ids.build,
    headRev: 1,
    entries: Object.fromEntries(entries.map((item) => [item.key, item])) as WorkingSet['entries'],
    entityOps,
  };
}

function run(options: {
  entries: OverrideEntry[];
  fromDoc?: DesignDoc;
  toDoc?: DesignDoc;
  fromControls?: ControlDecl[];
  toControls: ControlDecl[];
  aliases?: Record<string, string>;
  retired?: string[];
  migrate?: string[];
  targetControls?: string[];
  entityOps?: WorkingSet['entityOps'];
}) {
  const fromDoc = options.fromDoc ?? doc();
  const toDoc = options.toDoc ?? doc();
  return reapply({
    from: { buildId: ids.build, baseDoc: fromDoc, manifest: manifest(options.fromControls ?? [], {}) },
    to: {
      buildId: nextBuild,
      baseDoc: toDoc,
      manifest: manifest(options.toControls, {
        aliases: options.aliases,
        retired: options.retired,
        migrate: options.migrate,
      }),
    },
    workingSet: workingSet(options.entries, options.entityOps),
    targetControls: options.targetControls ?? [],
  });
}

describe('reapply', () => {
  it('produces the byte-stable AE2 report with 20 carried, one renamed, and two dropped', () => {
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/reapply-ae2.json', import.meta.url), 'utf8')) as {
      controls: string[];
      alias: Record<string, string>;
      retired: string[];
    };
    const golden = JSON.parse(
      readFileSync(new URL('./fixtures/reapply-ae2.golden.json', import.meta.url), 'utf8'),
    ) as unknown;
    const fromGlobals = Object.fromEntries(fixture.controls.map((id) => [id, 0]));
    const entries = fixture.controls.map((id) => entry(id, 1, 0));
    const toControlIds = [...fixture.controls.slice(0, 20), 'enemy.color'];
    const input = {
      entries,
      fromDoc: doc(fromGlobals),
      toDoc: doc(Object.fromEntries(toControlIds.map((id) => [id, 0]))),
      toControls: toControlIds.map((id) => control(id)),
      aliases: fixture.alias,
      retired: fixture.retired,
    };

    const first = run(input);
    const second = run({ ...input, entries: [...entries].reverse() });

    expect(first.report.carried).toHaveLength(20);
    expect(first.report.renamed).toEqual([{ from: 'enemy.tint@global', to: 'enemy.color@global' }]);
    expect(first.report.dropped).toEqual([
      { key: 'bat.wingflaps@global', reason: 'control_removed' },
      { key: 'door.removed@global', reason: 'control_removed' },
    ]);
    expect(canonical(first.report)).toBe(canonical(golden));
    expect(canonical(first)).toBe(canonical(second));
  });

  it('uses the new control default when manifest migration is required', () => {
    const result = run({
      entries: [entry('door.locked', 7, 3)],
      fromDoc: doc({ 'door.locked': 3 }),
      toDoc: doc({ 'door.locked': 4 }),
      toControls: [control('door.locked', { default: 4 })],
      migrate: ['door.locked'],
    });
    expect(result.report.needsChoice).toEqual([{ key: 'door.locked@global', mine: 7, allowed: 4 }]);
    expect(result.rebased.entries['door.locked@global']).toMatchObject({
      status: 'needs_choice',
      reason: 'migration_failed',
    });
  });

  it('offers a valid boundary without silently applying an invalid value', () => {
    const result = run({
      entries: [entry('door.locked', 15, 3)],
      fromDoc: doc({ 'door.locked': 3 }),
      toDoc: doc({ 'door.locked': 4 }),
      toControls: [control('door.locked', { max: 10, default: 4 })],
    });
    expect(result.report.needsChoice).toEqual([{ key: 'door.locked@global', mine: 15, allowed: 10 }]);
    expect(result.switchPatches).toEqual([]);
  });

  it('keeps the creator value and reports a builder conflict', () => {
    const result = run({
      entries: [entry('door.locked', 9, 5)],
      fromDoc: doc({ 'door.locked': 5 }),
      toDoc: doc({ 'door.locked': 7 }),
      toControls: [control('door.locked')],
    });
    expect(result.report.conflicts).toEqual([{ key: 'door.locked@global', mine: 9, builder: 7 }]);
    expect(result.rebased.entries['door.locked@global']).toMatchObject({
      value: 9,
      baseValueAtEdit: 7,
      status: 'conflict',
      reason: 'builder_changed',
    });
  });

  it('treats a builder value equal to mine as carried', () => {
    const result = run({
      entries: [entry('door.locked', 9, 5)],
      fromDoc: doc({ 'door.locked': 5 }),
      toDoc: doc({ 'door.locked': 9 }),
      toControls: [control('door.locked')],
    });
    expect(result.report.carried).toEqual(['door.locked@global']);
    expect(result.report.conflicts).toEqual([]);
  });

  it('lets the builder supersede only controls named by the job', () => {
    const result = run({
      entries: [entry('jump.height', 9, 5)],
      fromDoc: doc({ 'jump.height': 5 }),
      toDoc: doc({ 'jump.height': 5 }),
      toControls: [control('jump.height')],
      targetControls: ['jump.height'],
    });
    expect(result.report.dropped).toEqual([{ key: 'jump.height@global', reason: 'superseded_by_job' }]);
  });

  it('drops a missing target and a creator entity whose parent level disappeared', () => {
    const missingTarget = entry('enemy.color', 2, 1, removedEntity);
    const result = run({
      entries: [missingTarget, entry('enemy.color', 3, undefined, createdEntity)],
      fromDoc: doc(
        {},
        {
          [removedEntity]: {
            id: removedEntity,
            prefab: 'enemy',
            level: 'level_old',
            origin: 'build',
            props: { 'enemy.color': 1 },
          },
        },
      ),
      toDoc: doc(),
      toControls: [control('enemy.color')],
      entityOps: {
        [createdEntity]: {
          kind: 'create',
          entityId: createdEntity,
          parent: 'level_old',
          prefab: 'enemy',
          props: {},
          txId: ids.tx,
        },
      },
    });
    expect(result.report.dropped).toEqual([
      { key: `enemy.color@${createdEntity}`, reason: 'target_removed' },
      { key: `enemy.color@${removedEntity}`, reason: 'target_removed' },
    ]);
    expect(result.rebased.entityOps).toEqual({});
  });

  it('orders switch patches as creates, deletes, then stable property sets', () => {
    const anchor = {
      id: ids.entity,
      prefab: 'anchor',
      level: 'level_1',
      origin: 'build' as const,
      props: {},
    };
    const removed = { ...anchor, id: removedEntity, prefab: 'old' };
    const result = run({
      entries: [entry('enemy.color', 2, undefined, createdEntity)],
      toDoc: doc({}, { [ids.entity]: anchor, [removedEntity]: removed }),
      toControls: [control('enemy.color')],
      entityOps: {
        [createdEntity]: {
          kind: 'create',
          entityId: createdEntity,
          parent: 'level_1',
          prefab: 'enemy',
          props: {},
          txId: ids.tx,
        },
        [removedEntity]: { kind: 'delete', entityId: removedEntity, txId: ids.tx },
      },
    });
    expect(result.switchPatches.map((patch) => patch.path)).toEqual([
      ['entities', createdEntity],
      ['entities', removedEntity],
      ['entities', createdEntity, 'props', 'enemy.color'],
    ]);
  });

  it('replaces an existing scenery entity and restores its builder version on inverse', () => {
    const base = {
      id: ids.entity,
      prefab: 'scenery:tree',
      level: 'main',
      origin: 'build' as const,
      props: { pose: { position: [1, 0, 0] } },
    };
    const target = doc({}, { [ids.entity]: base });
    const pose = { position: [4, 0, 0] };
    const result = run({
      entries: [],
      toDoc: target,
      toControls: [],
      entityOps: {
        [ids.entity]: {
          kind: 'create',
          entityId: ids.entity,
          parent: 'main',
          prefab: 'scenery:tree',
          props: { pose },
          txId: ids.tx,
        },
      },
    });
    const switched = apply(target, result.switchPatches);
    expect(switched.entities[ids.entity]?.props.pose).toEqual(pose);
    expect(apply(switched, result.switchInverse)).toEqual(target);
  });

  it('makes switch patches equivalent to applying the rebased working set', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        (fromBase, toBase, mine) => {
          const result = run({
            entries: [entry('world.gravity', mine, fromBase)],
            fromDoc: doc({ 'world.gravity': fromBase }),
            toDoc: doc({ 'world.gravity': toBase }),
            toControls: [control('world.gravity')],
          });
          const expected = doc({
            'world.gravity': result.rebased.entries['world.gravity@global']?.value ?? toBase,
          });
          expect(canonical(apply(doc({ 'world.gravity': toBase }), result.switchPatches))).toBe(canonical(expected));
        },
      ),
      { numRuns: 100 },
    );
  });
});
