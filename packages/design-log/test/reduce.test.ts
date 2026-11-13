import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { EditorCommand } from '@ogm/contracts';

import { canonical } from '../src/canonical.js';
import { InvalidLogError, reduce } from '../src/reduce.js';
import { baseDoc, ids, setTx, transaction } from './helpers.js';

function reduceCommands(commands: Array<{ rev: number; command: EditorCommand }>) {
  return reduce({
    gameId: ids.game,
    branchId: ids.branch,
    buildId: ids.build,
    baseDoc: baseDoc(),
    txs: commands.map(({ rev, command }) => transaction(rev, [command], [])),
  });
}

describe('reduce', () => {
  it('keeps the last write and the original base value', () => {
    const result = reduce({
      gameId: ids.game,
      branchId: ids.branch,
      buildId: ids.build,
      baseDoc: baseDoc(),
      txs: [setTx(7, 'latest'), setTx(2, 'earlier')],
    });
    expect(result.entries[`door.locked@${ids.entity}`]).toMatchObject({
      value: 'latest',
      baseValueAtEdit: false,
      rev: 7,
      status: 'carried',
    });
    expect(result.headRev).toBe(7);
  });

  it('removes reset overrides', () => {
    const result = reduceCommands([
      { rev: 1, command: { op: 'set', control: 'door.locked', targets: [ids.entity], value: true } },
      { rev: 2, command: { op: 'reset', control: 'door.locked', targets: [ids.entity] } },
    ]);
    expect(result.entries).toEqual({});
  });

  it('turns entity create/delete invokes into a delete tombstone', () => {
    const created = 'e_01BX5ZZKBKACTAV9WEVGEMMVRZ';
    const result = reduceCommands([
      {
        rev: 1,
        command: {
          op: 'invoke',
          command: 'entity.create',
          args: { entityId: created, parent: 'level_1', prefab: 'key', props: { color: 'gold' } },
        },
      },
      { rev: 2, command: { op: 'invoke', command: 'entity.delete', args: { entityId: created } } },
    ]);
    expect(result.entityOps).toEqual({
      [created]: { kind: 'delete', entityId: created, txId: result.entityOps[created]?.txId },
    });
  });

  it('retains a created entity’s latest pose when reducing its transform', () => {
    const created = 'e_01BX5ZZKBKACTAV9WEVGEMMVRZ';
    const pose = { position: [4, 0, 3], rotationY: 90 };
    const result = reduceCommands([
      {
        rev: 1,
        command: {
          op: 'invoke',
          command: 'entity.create',
          args: { entityId: created, parent: 'main', prefab: 'scenery:tree', props: { pose: { position: [0, 0, 0] } } },
        },
      },
      { rev: 2, command: { op: 'invoke', command: 'entity.transform', args: { entityId: created, pose } } },
    ]);
    expect(result.entityOps[created]).toMatchObject({ kind: 'create', props: { pose } });
  });

  it('is independent of transaction and object insertion order', () => {
    fc.assert(
      fc.property(fc.array(fc.integer(), { minLength: 1, maxLength: 50 }), (values) => {
        const txs = values.map((value, index) => setTx(index + 1, value));
        const reverse = [...txs].reverse();
        const input = { gameId: ids.game, branchId: ids.branch, buildId: ids.build, baseDoc: baseDoc(), txs };
        expect(canonical(reduce(input))).toBe(canonical(reduce({ ...input, txs: reverse })));
      }),
      { numRuns: 200 },
    );
  });

  it('rejects foreign branches and duplicate revisions', () => {
    expect(() =>
      reduce({
        gameId: ids.game,
        branchId: ids.branch,
        buildId: ids.build,
        baseDoc: baseDoc(),
        txs: [setTx(1, true, ids.branchB)],
      }),
    ).toThrow(InvalidLogError);

    expect(() =>
      reduce({
        gameId: ids.game,
        branchId: ids.branch,
        buildId: ids.build,
        baseDoc: baseDoc(),
        txs: [setTx(1, true), setTx(1, false)],
      }),
    ).toThrow(InvalidLogError);
  });

  it('reduces 10,000 transactions over 2,000 entities well under the CI ceiling', () => {
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const suffix = (number: number) => {
      let encoded = '';
      do {
        encoded = alphabet[number % 32]! + encoded;
        number = Math.floor(number / 32);
      } while (number > 0);
      return encoded.padStart(4, '0');
    };
    const entityIds = Array.from({ length: 2_000 }, (_, index) => `${ids.entity.slice(0, -4)}${suffix(index)}`);
    const template = baseDoc().entities[ids.entity]!;
    const doc = {
      ...baseDoc(),
      entities: Object.fromEntries(entityIds.map((id) => [id, { ...template, id, props: { 'door.locked': false } }])),
    };
    const txs = Array.from({ length: 10_000 }, (_, index) =>
      transaction(
        index + 1,
        [{ op: 'set', control: 'door.locked', targets: [entityIds[index % entityIds.length]!], value: index }],
        [],
      ),
    );
    const started = performance.now();
    const result = reduce({ gameId: ids.game, branchId: ids.branch, buildId: ids.build, baseDoc: doc, txs });
    const elapsed = performance.now() - started;
    console.info(`reduce benchmark: ${elapsed.toFixed(1)} ms`);
    expect(result.headRev).toBe(10_000);
    expect(Object.keys(result.entries)).toHaveLength(2_000);
    expect(elapsed).toBeLessThan(500);
  });
});
