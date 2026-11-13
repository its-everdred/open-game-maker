import { describe, expect, it } from 'vitest';

import {
  DesignDocSchema,
  StableIdSchema,
  type DesignDoc,
  type EditorCommand,
  type Entity,
} from '@ogm/contracts/browser';
import { apply, canonical } from '@ogm/design-log/browser';

import {
  coalesceIntents,
  createEntityIntent,
  createIntent,
  createStableId,
  replayIntent,
  sceneryLightIntent,
  toTransactionBody,
  updateSceneryTransformIntent,
} from './transactions';

const entityId = 'e_01BX5ZZKBKACTAV9WEVGEMMVRZ';
const buildId = 'b_01BX5ZZKBKACTAV9WEVGEMMVRZ';

function baseDoc(): DesignDoc {
  return DesignDocSchema.parse({
    schemaVersion: 1,
    globals: {},
    entities: {
      [entityId]: {
        id: entityId,
        prefab: 'skeleton',
        level: 'crypt',
        origin: 'build',
        props: { 'enemy.speed': 1 },
      },
    },
  });
}

function speed(value: number): EditorCommand {
  return { op: 'set', control: 'enemy.speed', targets: [entityId], value };
}

describe('editor transaction intents', () => {
  it('replays and undoes a combined scenery rotation and scale', () => {
    const doc = baseDoc();
    doc.entities[entityId]!.prefab = 'scenery:tree';
    const intent = updateSceneryTransformIntent(
      doc,
      entityId,
      { position: [1, 0, 2], rotationY: 90 },
      [2, 2, 2],
      'Transform',
    );
    expect(apply(intent.doc, intent.inverse)).toEqual(doc);
    expect(replayIntent(intent, doc).doc).toEqual(intent.doc);
    const second = updateSceneryTransformIntent(
      intent.doc,
      entityId,
      { position: [1, 0, 2], rotationY: 120 },
      [3, 3, 3],
      'Transform',
    );
    const stroke = coalesceIntents([intent, second], 'Transform');
    expect(apply(doc, stroke.patches)).toEqual(second.doc);
    expect(apply(second.doc, stroke.inverse)).toEqual(doc);
  });
  it('replays and undoes scenery lighting changes', () => {
    const doc = baseDoc();
    doc.globals['scenery.settings'] = { version: 1, lighting: 'night', terrain: [], camera: {} };
    doc.globals['scenery.lighting'] = 'night';
    const intent = sceneryLightIntent(doc, 'cave');
    expect(intent.doc.globals['scenery.lighting']).toBe('cave');
    expect(apply(intent.doc, intent.inverse)).toEqual(doc);
    expect(replayIntent(intent, doc).doc).toEqual(intent.doc);
  });
  it('coalesces a 40-step stroke and restores the byte-identical starting document', () => {
    const original = baseDoc();
    let current = original;
    const steps = Array.from({ length: 40 }, (_, index) => {
      const intent = createIntent(current, [speed(index + 2)], 'Move skeleton');
      current = intent.doc;
      return intent;
    });

    const stroke = coalesceIntents(steps, 'Move skeleton');

    expect(stroke.patches).toHaveLength(1);
    expect(stroke.inverse).toHaveLength(1);
    expect(stroke.commands).toHaveLength(40);
    expect(canonical(apply(apply(original, stroke.patches), stroke.inverse))).toBe(canonical(original));
  });

  it('replays original commands against a newer snapshot instead of reusing stale patches', () => {
    const pending = createIntent(baseDoc(), [speed(4)], 'Speed up');
    const newer = createIntent(baseDoc(), [speed(3)], 'Remote speed').doc;

    const replayed = replayIntent(pending, newer);
    const body = toTransactionBody(replayed, {
      baseRev: 7,
      leaseToken: 12,
      baseBuildId: buildId,
      sessionId: 'session-a',
    });

    expect(body.baseRev).toBe(7);
    expect(body.commands).toEqual([speed(4)]);
    expect(body.inverse).not.toEqual(pending.inverse);
    expect(canonical(apply(replayed.doc, body.inverse))).toBe(canonical(newer));
    expect(replayed.doc.entities[entityId]?.props['enemy.speed']).toBe(4);
  });

  it('pairs an entity create invoke with an add patch and exact remove inverse', () => {
    const original = baseDoc();
    const entity: Entity = {
      id: createStableId('e_', 1_700_000_000_000, new Uint8Array(10).fill(7)),
      prefab: 'key',
      level: 'crypt',
      origin: 'creator',
      props: { color: 'gold' },
    };

    const intent = createEntityIntent(original, entity, 'Place key');

    expect(StableIdSchema.safeParse(entity.id).success).toBe(true);
    expect(intent.commands).toEqual([
      {
        op: 'invoke',
        command: 'entity.create',
        args: { entityId: entity.id, parent: 'crypt', prefab: 'key', props: { color: 'gold' } },
      },
    ]);
    expect(intent.patches).toEqual([{ op: 'add', path: ['entities', entity.id], value: entity }]);
    expect(intent.inverse).toEqual([{ op: 'remove', path: ['entities', entity.id] }]);
    expect(canonical(apply(intent.doc, intent.inverse))).toBe(canonical(original));
  });
});
