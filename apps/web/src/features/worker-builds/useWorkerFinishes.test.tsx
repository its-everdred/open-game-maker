import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useWorkerFinishes } from './useWorkerFinishes';

describe('worker finishing state', () => {
  it('announces only a newly confirmed completion of a worker seen in this session', () => {
    const worker = {
      ticket: 'game:12',
      title: 'Forest backdrop',
      percent: 50,
      etaSeconds: 10,
      startedAt: '2026-11-01T00:00:00Z',
    };
    const feed = { gameId: 'game', cursor: 10, completed: [{ ticket: '12', seq: 9, at: '2026-10-31T23:59:59Z' }] };
    const { result, rerender } = renderHook(({ workers, feeds }) => useWorkerFinishes(workers, feeds), {
      initialProps: { workers: [worker], feeds: [feed] },
    });
    rerender({ workers: [], feeds: [feed] });
    expect(result.current.finished).toEqual([]);
    rerender({
      workers: [],
      feeds: [{ gameId: 'game', cursor: 11, completed: [{ ticket: '12', seq: 11, at: '2026-11-01T00:00:01Z' }] }],
    });
    expect(result.current.finished).toEqual([{ ticket: 'game:12', title: 'Forest backdrop' }]);
    act(() => result.current.dismiss());
    expect(result.current.finished).toEqual([]);
  });
  it('does not show one account’s completed worker after an account switch', () => {
    const worker = {
      ticket: 'game:12',
      title: 'Forest backdrop',
      percent: 50,
      etaSeconds: 10,
      startedAt: '2026-11-01T00:00:00Z',
    };
    const { result, rerender } = renderHook(
      ({ workers, cursor, completed, scope }) =>
        useWorkerFinishes(workers, [{ gameId: 'game', cursor, completed }], scope),
      {
        initialProps: {
          workers: [worker],
          cursor: 1,
          completed: [] as Array<{ ticket: string; seq: number; at: string }>,
          scope: 'one',
        },
      },
    );
    rerender({
      workers: [],
      cursor: 2,
      completed: [{ ticket: '12', seq: 2, at: '2026-11-01T00:00:01Z' }],
      scope: 'one',
    });
    expect(result.current.finished).toHaveLength(1);
    rerender({
      workers: [],
      cursor: 2,
      completed: [{ ticket: '12', seq: 2, at: '2026-11-01T00:00:01Z' }],
      scope: 'two',
    });
    expect(result.current.finished).toEqual([]);
  });
  it('announces a completion first seen alongside its still-running worker', () => {
    const worker = {
      ticket: 'game:12',
      title: 'Forest backdrop',
      percent: 100,
      etaSeconds: 0,
      startedAt: '2026-11-01T00:00:00Z',
    };
    const feed = { gameId: 'game', cursor: 12, completed: [{ ticket: '12', seq: 11, at: '2026-11-01T00:00:01Z' }] };
    const { result, rerender } = renderHook(({ workers }) => useWorkerFinishes(workers, [feed]), {
      initialProps: { workers: [worker] },
    });
    rerender({ workers: [] });
    expect(result.current.finished).toEqual([{ ticket: 'game:12', title: 'Forest backdrop' }]);
  });
  it('does not announce a delayed completion from before the current worker started', () => {
    const worker = {
      ticket: 'game:12',
      title: 'Forest backdrop',
      percent: 50,
      etaSeconds: 10,
      startedAt: '2026-11-02T00:00:00Z',
    };
    const { result, rerender } = renderHook(({ workers, feeds }) => useWorkerFinishes(workers, feeds), {
      initialProps: {
        workers: [worker],
        feeds: [{ gameId: 'game', cursor: 1, completed: [] as Array<{ ticket: string; seq: number; at: string }> }],
      },
    });
    rerender({
      workers: [],
      feeds: [{ gameId: 'game', cursor: 2, completed: [{ ticket: '12', seq: 2, at: '2026-11-01T00:00:00Z' }] }],
    });
    expect(result.current.finished).toEqual([]);
  });
  it('does not infer a completion when the worker start time is unknown', () => {
    const worker = { ticket: 'game:12', title: 'Forest backdrop', percent: null, etaSeconds: null };
    const { result, rerender } = renderHook(({ workers, feeds }) => useWorkerFinishes(workers, feeds), {
      initialProps: {
        workers: [worker],
        feeds: [{ gameId: 'game', cursor: 1, completed: [] as Array<{ ticket: string; seq: number; at: string }> }],
      },
    });
    rerender({
      workers: [],
      feeds: [{ gameId: 'game', cursor: 2, completed: [{ ticket: '12', seq: 2, at: '2026-11-01T00:00:01Z' }] }],
    });
    expect(result.current.finished).toEqual([]);
  });
  it('tracks a new run when the same ticket restarts between polls', () => {
    const first = {
      ticket: 'game:12',
      title: 'Forest backdrop',
      percent: 50,
      etaSeconds: 10,
      startedAt: '2026-11-01T00:00:00Z',
    };
    const second = { ...first, startedAt: '2026-11-02T00:00:00Z' };
    const { result, rerender } = renderHook(({ workers, feeds }) => useWorkerFinishes(workers, feeds), {
      initialProps: {
        workers: [first],
        feeds: [{ gameId: 'game', cursor: 1, completed: [] as Array<{ ticket: string; seq: number; at: string }> }],
      },
    });
    rerender({ workers: [second], feeds: [{ gameId: 'game', cursor: 2, completed: [] }] });
    rerender({
      workers: [],
      feeds: [{ gameId: 'game', cursor: 3, completed: [{ ticket: '12', seq: 3, at: '2026-11-01T01:00:00Z' }] }],
    });
    expect(result.current.finished).toEqual([]);
  });
});
