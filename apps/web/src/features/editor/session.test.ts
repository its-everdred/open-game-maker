import { afterEach, describe, expect, it, vi } from 'vitest';

import { DesignDocSchema, type DesignDoc, type Transaction } from '@ogm/contracts/browser';
import { canonical } from '@ogm/design-log/browser';

import type { DesignSnapshot, TransactionBody, TransactionPostResult } from './api';
import { createEditorSession } from './session';
import { createIntent } from './transactions';

const entityId = 'e_01BX5ZZKBKACTAV9WEVGEMMVRZ';
const buildId = 'b_01BX5ZZKBKACTAV9WEVGEMMVRZ';

function doc(speed = 1): DesignDoc {
  return DesignDocSchema.parse({
    schemaVersion: 1,
    globals: {},
    entities: {
      [entityId]: {
        id: entityId,
        prefab: 'skeleton',
        level: 'crypt',
        origin: 'build',
        props: { 'enemy.speed': speed },
      },
    },
  });
}

function snapshot(rev = 4, speed = 1): DesignSnapshot {
  return { rev, buildId, doc: doc(speed) };
}

function intent(source = doc(), value = 4) {
  return createIntent(source, [{ op: 'set', control: 'enemy.speed', targets: [entityId], value }], 'Change speed');
}

function setup(results: TransactionPostResult[], authoritative = snapshot()) {
  const postTransaction = vi.fn(async (body: TransactionBody) => {
    void body;
    return results.shift() ?? { ok: true as const, rev: 99 };
  });
  const getSnapshot = vi.fn(async () => authoritative);
  const applyDesign = vi.fn();
  const store = createEditorSession({
    sessionId: 'session-a',
    leaseToken: 8,
    snapshot: snapshot(),
    retryDelayMs: 1,
    api: { postTransaction, getSnapshot },
    applyDesign,
  });
  return { store, postTransaction, getSnapshot, applyDesign };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('editor session', () => {
  it('keeps an ephemeral preview marked unsaved after local edits', async () => {
    const store = createEditorSession({
      sessionId: 'preview',
      leaseToken: 0,
      snapshot: snapshot(),
      ephemeral: true,
      api: { postTransaction: async () => ({ ok: true, rev: 5 }), getSnapshot: async () => snapshot() },
    });
    await store.getState().submit(intent());
    expect(store.getState()).toMatchObject({ saved: 'not-saved', headRev: 5, canUndo: true });
    expect(store.getState().doc.entities[entityId]?.props['enemy.speed']).toBe(4);
  });
  it('reloads and replays once after a 409 before reporting saved', async () => {
    const { store, postTransaction, getSnapshot } = setup(
      [
        { ok: false, kind: 'conflict', headRev: 7 },
        { ok: true, rev: 8 },
      ],
      snapshot(7, 3),
    );

    await store.getState().submit(intent());

    expect(getSnapshot).toHaveBeenCalledOnce();
    expect(postTransaction.mock.calls.map(([body]) => body.baseRev)).toEqual([4, 7]);
    expect(store.getState()).toMatchObject({ headRev: 8, saved: 'saved', readOnly: false, canUndo: true });
    expect(store.getState().doc.entities[entityId]?.props['enemy.speed']).toBe(4);
  });

  it('reloads authoritative state and clears local history after a 423', async () => {
    const { store, postTransaction, getSnapshot } = setup(
      [{ ok: false, kind: 'lease-lost', holder: 'other-session' }],
      snapshot(6, 9),
    );

    await store.getState().submit(intent());
    await store.getState().submit(intent(store.getState().doc, 5));

    expect(getSnapshot).toHaveBeenCalledOnce();
    expect(postTransaction).toHaveBeenCalledOnce();
    expect(store.getState()).toMatchObject({ headRev: 6, saved: 'read-only', readOnly: true, canUndo: false });
    expect(store.getState().doc.entities[entityId]?.props['enemy.speed']).toBe(9);
  });

  it('keeps a network failure retryable and resends the unchanged intent', async () => {
    vi.useFakeTimers();
    const { store, postTransaction } = setup([
      { ok: false, kind: 'retryable', message: 'offline' },
      { ok: true, rev: 5 },
    ]);

    const saved = store.getState().submit(intent());
    await vi.advanceTimersByTimeAsync(1);
    await saved;

    expect(postTransaction).toHaveBeenCalledTimes(2);
    expect(postTransaction.mock.calls[1]?.[0]).toEqual(postTransaction.mock.calls[0]?.[0]);
    expect(store.getState().saved).toBe('saved');
  });

  it('reports a failed conflict refresh instead of staying on Saving', async () => {
    const { store, getSnapshot } = setup([{ ok: false, kind: 'conflict', headRev: 7 }]);
    getSnapshot.mockRejectedValueOnce(new Error('refresh offline'));

    await expect(store.getState().submit(intent())).resolves.toBeUndefined();

    expect(store.getState()).toMatchObject({ saved: 'not-saved', error: 'refresh offline' });
  });

  it('appends an inverse transaction for undo and preserves redo', async () => {
    const { store, postTransaction } = setup([
      { ok: true, rev: 5 },
      { ok: true, rev: 6 },
    ]);
    const change = intent();

    await store.getState().submit(change);
    await store.getState().undo();

    expect(postTransaction.mock.calls[1]?.[0].patches).toEqual(change.inverse);
    expect(canonical(store.getState().doc)).toBe(canonical(doc()));
    expect(store.getState()).toMatchObject({ headRev: 6, canUndo: false, canRedo: true });
  });

  it('coalesces a stroke into one post and one undo entry', async () => {
    const { store, postTransaction } = setup([{ ok: true, rev: 5 }]);
    let current = doc();
    const steps = Array.from({ length: 40 }, (_, index) => {
      const step = intent(current, index + 2);
      current = step.doc;
      return step;
    });

    await store.getState().commitStroke(steps, 'Move skeleton');

    expect(postTransaction).toHaveBeenCalledOnce();
    expect(postTransaction.mock.calls[0]?.[0].patches).toHaveLength(1);
    expect(store.getState().canUndo).toBe(true);
  });

  it('applies a remote revision once and ignores reconciled duplicates', () => {
    const { store, applyDesign } = setup([]);
    const remoteIntent = intent(doc(), 3);
    const transaction = {
      rev: 5,
      baseRev: 4,
      patches: remoteIntent.patches,
      inverse: remoteIntent.inverse,
    } as Transaction;

    store.getState().receive(transaction);
    store.getState().receive(transaction);

    expect(store.getState().headRev).toBe(5);
    expect(store.getState().doc.entities[entityId]?.props['enemy.speed']).toBe(3);
    expect(applyDesign).toHaveBeenCalledOnce();
  });
});
