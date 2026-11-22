import { SceneDocSchema, type SceneDoc, type SceneHead, type SceneRevision } from '@ogm/contracts';
import { describe, expect, it } from 'vitest';

import {
  commitScene,
  describeConflict,
  migrateScene,
  sceneAt,
  sha256Canonical,
  type CommitSceneInput,
  type SceneMigrations,
} from '../src/index.js';

const now = new Date('2026-11-22T06:00:00.000Z');

function sample(): SceneDoc {
  return {
    schemaVersion: 1,
    game: 'dusk-helm',
    scene: 'graveyard',
    packAdapter: 'smallscaleint',
    layers: {
      floor: { kind: 'tiles', order: 0, tiles: { '0,0': { asset: 'grass-a' }, '1,0': { asset: 'grass-b' } } },
      decor: { kind: 'objects', order: 2 },
    },
    objects: {
      'tree-1': { asset: 'oak', layer: 'decor', pose: { x: 2, y: 3 }, facing: 'S' },
      'grave-1': { asset: 'grave', layer: 'decor', pose: { x: 5, y: 1 } },
    },
    hd2d: { lighting: { settings: { ambient: { color: '#223344', intensity: 0.3 } } } },
  };
}

type Store = { head: SceneHead; log: SceneRevision[] };

function store(): Store {
  return { head: { rev: 0, doc: sample() }, log: [] };
}

/** A writer's edit starts from the document at `baseRev`, as `gm scene pull` or the editor would hand it out. */
function edit(at: Store, baseRev: number, change: (doc: SceneDoc) => void): SceneDoc {
  const doc = structuredClone(sceneAt(at.head, at.log, baseRev));
  change(doc);
  return doc;
}

function push(
  at: Store,
  input: Pick<CommitSceneInput, 'doc' | 'baseRev' | 'author'> & Partial<CommitSceneInput>,
): ReturnType<typeof commitScene> {
  const result = commitScene({
    head: at.head,
    log: at.log,
    source: input.author.startsWith('agent:') ? 'cli' : 'editor',
    label: 'edit',
    now,
    ...input,
  });
  if (result.ok && result.revision) {
    at.head = result.head;
    at.log.push(result.revision);
  }
  return result;
}

function kevinMovesTree(at: Store): void {
  const result = push(at, {
    author: 'kevin',
    baseRev: at.head.rev,
    doc: edit(at, at.head.rev, (doc) => {
      doc.objects['tree-1']!.pose = { x: 9, y: 9 };
    }),
  });
  expect(result.ok).toBe(true);
}

describe('scene round trip between Kevin and agents', () => {
  it("keeps Kevin's move when an agent pushes other edits on the revision before it", () => {
    const at = store();
    const agentDoc = edit(at, 0, (doc) => {
      doc.objects['grave-2'] = { asset: 'grave', layer: 'decor', pose: { x: 6, y: 1 } };
      doc.layers.floor!.tiles!['2,0'] = { asset: 'path-a' };
    });
    kevinMovesTree(at);

    const result = push(at, { author: 'agent:1207', baseRev: 0, doc: agentDoc });

    // The agent's stale copy still has the tree at 2,3; rebasing must not put it back there.
    expect(result).toMatchObject({ ok: true, rebased: true });
    expect(at.head.doc.objects['tree-1']).toMatchObject({ pose: { x: 9, y: 9 }, lockedBy: 'creator' });
    expect(at.head.doc.objects['grave-2']).toBeDefined();
    expect(at.head.doc.layers.floor!.tiles!['2,0']).toEqual({ asset: 'path-a' });
  });

  it("refuses an agent push that moves the object Kevin moved, naming Kevin's value", () => {
    const at = store();
    const agentDoc = edit(at, 0, (doc) => {
      doc.objects['tree-1']!.pose = { x: 4, y: 4 };
      doc.objects['grave-1']!.pose = { x: 7, y: 7 };
    });
    kevinMovesTree(at);
    const before = at.head;

    const result = push(at, { author: 'agent:1207', baseRev: 0, doc: agentDoc });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.conflicts).toEqual([
      expect.objectContaining({ unit: 'object:tree-1', reason: 'creator_locked', by: 'kevin' }),
    ]);
    expect(describeConflict(result.conflicts[0]!)).toContain('"x":9');
    // Atomic: the agent's unrelated grave move does not land half-way either.
    expect(at.head).toBe(before);
  });

  it('keeps refusing agent edits to what Kevin touched after the agent has pulled his revision', () => {
    const at = store();
    kevinMovesTree(at);

    const result = push(at, {
      author: 'agent:1207',
      baseRev: at.head.rev,
      doc: edit(at, at.head.rev, (doc) => {
        doc.objects['tree-1']!.facing = 'N';
      }),
    });

    expect(result).toMatchObject({ ok: false, conflicts: [{ unit: 'object:tree-1', reason: 'creator_locked' }] });
  });

  it('does not let an agent unlock what Kevin owns by dropping lockedBy', () => {
    const at = store();
    kevinMovesTree(at);

    const result = push(at, {
      author: 'agent:1207',
      baseRev: at.head.rev,
      doc: edit(at, at.head.rev, (doc) => {
        delete doc.objects['tree-1']!.lockedBy;
      }),
    });

    expect(result).toMatchObject({ ok: true, revision: null });
    expect(at.head.doc.objects['tree-1']!.lockedBy).toBe('creator');
  });

  it('refuses an agent bringing back an object Kevin deleted, and paints in a layer Kevin locked', () => {
    const at = store();
    push(at, {
      author: 'kevin',
      baseRev: 0,
      doc: edit(at, 0, (doc) => {
        delete doc.objects['grave-1'];
        doc.layers.floor!.lockedBy = 'creator';
      }),
    });

    const result = push(at, {
      author: 'agent:1207',
      baseRev: at.head.rev,
      doc: edit(at, at.head.rev, (doc) => {
        doc.objects['grave-1'] = { asset: 'grave', layer: 'decor', pose: { x: 5, y: 1 } };
        doc.layers.floor!.tiles!['0,0'] = { asset: 'water' };
      }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.conflicts.map(({ unit, reason }) => [unit, reason])).toEqual([
      ['tile:floor:0,0', 'creator_locked'],
      ['object:grave-1', 'creator_locked'],
    ]);
  });

  it('hands a unit back to the agents when Kevin unlocks it', () => {
    const at = store();
    kevinMovesTree(at);
    push(at, {
      author: 'kevin',
      baseRev: at.head.rev,
      doc: edit(at, at.head.rev, (doc) => {
        delete doc.objects['tree-1']!.lockedBy;
      }),
    });

    const result = push(at, {
      author: 'agent:1207',
      baseRev: at.head.rev,
      doc: edit(at, at.head.rev, (doc) => {
        doc.objects['tree-1']!.pose = { x: 1, y: 1 };
      }),
    });

    expect(result.ok).toBe(true);
    expect(at.head.doc.objects['tree-1']!.pose).toEqual({ x: 1, y: 1 });
  });

  it("lets Kevin's stale editor save win without undoing an agent's later edits", () => {
    const at = store();
    const kevinDoc = edit(at, 0, (doc) => {
      doc.objects['tree-1']!.pose = { x: 9, y: 9 };
    });
    push(at, {
      author: 'agent:1207',
      baseRev: 0,
      doc: edit(at, 0, (doc) => {
        doc.objects['tree-1']!.pose = { x: 4, y: 4 };
        doc.objects['grave-1']!.pose = { x: 7, y: 7 };
      }),
    });

    expect(push(at, { author: 'kevin', baseRev: 0, doc: kevinDoc }).ok).toBe(true);
    expect(at.head.doc.objects['tree-1']!.pose).toEqual({ x: 9, y: 9 });
    expect(at.head.doc.objects['grave-1']!.pose).toEqual({ x: 7, y: 7 });
  });

  it("refuses an agent overwriting another agent's newer change to the same unit", () => {
    const at = store();
    const stale = edit(at, 0, (doc) => {
      doc.objects['grave-1']!.pose = { x: 8, y: 8 };
    });
    push(at, {
      author: 'agent:1208',
      baseRev: 0,
      doc: edit(at, 0, (doc) => {
        doc.objects['grave-1']!.pose = { x: 7, y: 7 };
      }),
    });

    expect(push(at, { author: 'agent:1207', baseRev: 0, doc: stale })).toMatchObject({
      ok: false,
      conflicts: [{ unit: 'object:grave-1', reason: 'changed_since_base', by: 'agent:1208' }],
    });
  });

  // Kevin's delete of a whole layer must win even when an agent painted into it after the copy he deleted from.
  it("takes an agent's newer tiles with the layer when Kevin's stale editor deletes it", () => {
    const at = store();
    const kevinDoc = edit(at, 0, (doc) => {
      delete doc.layers.floor;
    });
    push(at, {
      author: 'agent:1207',
      baseRev: 0,
      doc: edit(at, 0, (doc) => {
        doc.layers.floor!.tiles!['2,0'] = { asset: 'path-a' };
      }),
    });

    expect(push(at, { author: 'kevin', baseRev: 0, doc: kevinDoc })).toMatchObject({ ok: true });
    expect(at.head.doc.layers.floor).toBeUndefined();
  });

  it('refuses an agent painting into or placing on a layer Kevin deleted, rather than failing', () => {
    const at = store();
    const agentDoc = edit(at, 0, (doc) => {
      doc.layers.floor!.tiles!['2,0'] = { asset: 'path-a' };
      doc.objects['grave-2'] = { asset: 'grave', layer: 'decor', pose: { x: 6, y: 1 } };
    });
    push(at, {
      author: 'kevin',
      baseRev: 0,
      doc: edit(at, 0, (doc) => {
        delete doc.layers.floor;
        delete doc.layers.decor;
        doc.objects = {};
      }),
    });

    const result = push(at, { author: 'agent:1207', baseRev: 0, doc: agentDoc });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ unit: 'tile:floor:2,0', reason: 'creator_locked', by: 'kevin' }),
        expect.objectContaining({ unit: 'object:grave-2', reason: 'creator_locked', by: 'kevin' }),
      ]),
    );
  });

  it("refuses an agent deleting a layer that holds Kevin's newer tile", () => {
    const at = store();
    const agentDoc = edit(at, 0, (doc) => {
      delete doc.layers.floor;
    });
    push(at, {
      author: 'kevin',
      baseRev: 0,
      doc: edit(at, 0, (doc) => {
        doc.layers.floor!.tiles!['5,5'] = { asset: 'flowers' };
      }),
    });

    expect(push(at, { author: 'agent:1207', baseRev: 0, doc: agentDoc })).toMatchObject({
      ok: false,
      conflicts: [{ unit: 'tile:floor:5,5', reason: 'creator_locked', by: 'kevin' }],
    });
    expect(at.head.doc.layers.floor?.tiles?.['5,5']).toMatchObject({ asset: 'flowers' });
  });

  it('accepts an agent deleting what Kevin already deleted', () => {
    const at = store();
    const agentDoc = edit(at, 0, (doc) => {
      delete doc.objects['grave-1'];
    });
    push(at, {
      author: 'kevin',
      baseRev: 0,
      doc: edit(at, 0, (doc) => {
        delete doc.objects['grave-1'];
      }),
    });

    expect(push(at, { author: 'agent:1207', baseRev: 0, doc: agentDoc })).toMatchObject({ ok: true, revision: null });
  });
});

describe('scene revisions', () => {
  it('records author, source, parent and base, and can rebuild any earlier revision', () => {
    const at = store();
    const original = structuredClone(at.head.doc);
    kevinMovesTree(at);
    const afterKevin = structuredClone(at.head.doc);
    push(at, {
      author: 'agent:1207',
      baseRev: 0,
      doc: edit(at, 0, (doc) => {
        doc.layers.floor!.tiles!['2,0'] = { asset: 'path-a' };
      }),
    });

    expect(
      at.log.map(({ rev, parentRev, baseRev, author, source }) => ({ rev, parentRev, baseRev, author, source })),
    ).toEqual([
      { rev: 1, parentRev: 0, baseRev: 0, author: 'kevin', source: 'editor' },
      { rev: 2, parentRev: 1, baseRev: 0, author: 'agent:1207', source: 'cli' },
    ]);
    expect(at.log[1]!.changes).toEqual([{ unit: 'tile:floor:2,0', after: { asset: 'path-a' } }]);
    expect(at.log[1]!.docHash).toBe(sha256Canonical(at.head.doc));
    expect(sceneAt(at.head, at.log, 0)).toEqual(original);
    expect(sceneAt(at.head, at.log, 1)).toEqual(afterKevin);
  });

  it("lets Kevin switch the scene's pack adapter", () => {
    const at = store();
    const result = push(at, {
      author: 'kevin',
      baseRev: 0,
      doc: edit(at, 0, (doc) => {
        doc.packAdapter = 'kaykit';
      }),
    });

    expect(result.ok).toBe(true);
    expect(at.head.doc.packAdapter).toBe('kaykit');
  });

  it('refuses a document that breaks the schema after rebasing', () => {
    const at = store();
    push(at, {
      author: 'kevin',
      baseRev: 0,
      doc: edit(at, 0, (doc) => {
        doc.layers.props = { kind: 'objects', order: 3 };
      }),
    });
    const bad = edit(at, at.head.rev, (doc) => {
      doc.objects['lamp-1'] = { asset: 'lamp', layer: 'floor', pose: { x: 0, y: 0 } };
    });

    expect(() => push(at, { author: 'agent:1207', baseRev: at.head.rev, doc: bad })).toThrow(/objects layer/);
  });
});

describe('scene migrations', () => {
  // A stand-in for the first real schema change: version 0 kept objects in an array. The runner must carry every
  // object across, because a migration that drops one silently loses Kevin's work.
  const migrations: SceneMigrations = {
    0: (doc) => {
      const { objects, ...rest } = doc as { objects: ({ id: string } & Record<string, unknown>)[] };
      return { ...rest, objects: Object.fromEntries(objects.map(({ id, ...object }) => [id, object])) };
    },
  };

  it('migrates an older scene losslessly to the current version', () => {
    const current = sample();
    const old = {
      ...current,
      schemaVersion: 0,
      objects: Object.entries(current.objects).map(([id, object]) => ({ id, ...object })),
    };

    const { doc, from } = migrateScene(JSON.parse(JSON.stringify(old)), migrations);

    expect(from).toBe(0);
    expect(doc).toEqual(current);
    expect(migrateScene(JSON.parse(JSON.stringify(doc)), migrations)).toEqual({ doc: current, from: 1 });
  });

  it('reads a current scene back unchanged through JSON', () => {
    expect(migrateScene(JSON.parse(JSON.stringify(sample())))).toEqual({
      doc: SceneDocSchema.parse(sample()),
      from: 1,
    });
  });

  it('refuses scenes it cannot read rather than guessing', () => {
    expect(() => migrateScene({ ...sample(), schemaVersion: 2 })).toThrow(/newer/);
    expect(() => migrateScene({ ...sample(), schemaVersion: 0 })).toThrow(/no migration/);
  });

  it('will not rebuild a base from before a migration revision', () => {
    const migrated: SceneRevision = {
      rev: 1,
      parentRev: 0,
      baseRev: 0,
      author: 'agent:1207',
      source: 'migration',
      label: 'migrate',
      createdAt: now.toISOString(),
      changes: [],
      docHash: sha256Canonical(sample()),
    };
    expect(() => sceneAt({ rev: 1, doc: sample() }, [migrated], 0)).toThrow(/pull it again/);
  });
});
