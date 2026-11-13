import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';

import type { DesignDoc, GameManifest, PlacementResult, TargetRef } from '@ogm/contracts/browser';

import type { GameFrameController } from './frame';
import { GizmoOverlay } from './GizmoOverlay';
import type { EditorSessionState } from './session';

const entityId = 'e_01BX5ZZKBKACTAV9WEVGEMMVRZ';
const doc: DesignDoc = {
  schemaVersion: 1,
  globals: {},
  entities: {
    [entityId]: {
      id: entityId,
      prefab: 'skeleton',
      level: 'crypt',
      origin: 'creator',
      props: { pose: { position: [10, 10, 0] } },
    },
  },
};
const manifest = {
  dimension: '2d',
  view: 'main',
  presentation: { minLogical: { w: 100, h: 60 } },
  gizmos: { skeleton: ['translate'] },
} as unknown as GameManifest;

function harness(selection: string[] = []) {
  let picked: ((targets: TargetRef[]) => void) | undefined;
  const placements: Array<(result: PlacementResult) => void> = [];
  const submit = vi.fn().mockResolvedValue(undefined);
  const commitStroke = vi.fn().mockResolvedValue(undefined);
  const setSelection = vi.fn();
  const state = {
    doc,
    headRev: 4,
    selection,
    tool: 'select',
    readOnly: false,
    submit,
    commitStroke,
    setSelection,
  } as unknown as EditorSessionState;
  const session = { getState: () => state } as StoreApi<EditorSessionState>;
  const frame = {
    applyDesign: vi.fn(),
    pick: vi.fn(),
    pickAt: vi.fn(),
    select: vi.fn(),
    validatePlacement: vi.fn(() => new Promise<PlacementResult>((resolve) => placements.push(resolve))),
    onPicked: vi.fn((callback) => {
      picked = callback;
      return vi.fn();
    }),
    onScreen: vi.fn(() => vi.fn()),
  } as unknown as GameFrameController;
  return {
    commitStroke,
    frame,
    placement: (result: PlacementResult) => placements.shift()?.(result),
    picked: (targets: TargetRef[]) => picked?.(targets),
    session,
    setSelection,
    submit,
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('GizmoOverlay', () => {
  it('paints a projected terrain band as one undoable change', async () => {
    const test = harness();
    test.session.getState().doc = { ...doc, globals: { 'scenery.settings': { terrain: [] } } };
    test.frame.project = vi.fn().mockResolvedValueOnce([2, 0, 1]).mockResolvedValueOnce([4, 0, 2]);
    render(
      <GizmoOverlay
        activePrefab="scenery-band:water"
        frame={test.frame}
        manifest={{ ...manifest, dimension: '3d', capabilities: ['editor.project'] }}
        session={test.session}
        snap={{ version: 1, enabled: false, grid: 1 }}
      />,
    );
    const canvas = screen.getByLabelText('Editor canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 60 } as DOMRect);
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 });
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'touch', clientX: 40, clientY: 30 });
    await act(async () => {});
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 50, clientY: 40 });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(test.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        commands: [
          expect.objectContaining({
            op: 'set',
            control: 'scenery.terrain',
            value: [
              expect.objectContaining({
                kind: 'water',
                points: [
                  [2, 0, 1],
                  [4, 0, 2],
                ],
              }),
            ],
          }),
        ],
      }),
    );
  });

  it('does not paint a terrain stroke cancelled before projection completes', async () => {
    const test = harness();
    test.session.getState().doc = { ...doc, globals: { 'scenery.settings': { terrain: [] } } };
    const finishes: Array<(value: [number, number, number] | null) => void> = [];
    test.frame.project = vi.fn(
      () =>
        new Promise<[number, number, number] | null>((resolve) => {
          finishes.push(resolve);
        }),
    );
    render(
      <GizmoOverlay
        activePrefab="scenery-band:path"
        frame={test.frame}
        manifest={{ ...manifest, dimension: '3d', capabilities: ['editor.project'] }}
        session={test.session}
        snap={{ version: 1, enabled: false, grid: 1 }}
      />,
    );
    const canvas = screen.getByLabelText('Editor canvas');
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 40, clientY: 30 });
    expect(test.frame.project).toHaveBeenCalledTimes(2);
    fireEvent.pointerCancel(canvas, { pointerId: 1 });
    await act(async () => {
      finishes[0]?.([2, 0, 1]);
      finishes[1]?.([4, 0, 1]);
    });
    expect(test.submit).not.toHaveBeenCalled();
  });

  it('retains consecutive strokes when their projections finish out of order', async () => {
    const test = harness();
    const state = test.session.getState();
    state.doc = { ...doc, globals: { 'scenery.terrain': [] } };
    const finishes: Array<(value: [number, number, number]) => void> = [];
    test.frame.project = vi.fn(() => new Promise<[number, number, number]>((resolve) => finishes.push(resolve)));
    test.submit.mockImplementation(async (intent) => {
      state.doc = { ...state.doc, globals: { ...state.doc.globals, 'scenery.terrain': intent.commands[0].value } };
    });
    render(
      <GizmoOverlay
        activePrefab="scenery-band:path"
        frame={test.frame}
        manifest={{ ...manifest, dimension: '3d', capabilities: ['editor.project'] }}
        session={test.session}
        snap={{ version: 1, enabled: false, grid: 1 }}
      />,
    );
    const canvas = screen.getByLabelText('Editor canvas');
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 40, clientY: 30 });
    fireEvent.pointerDown(canvas, { pointerId: 2, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(canvas, { pointerId: 2, clientX: 40, clientY: 30 });
    await act(async () => {
      finishes[2]?.([5, 0, 1]);
      finishes[3]?.([6, 0, 1]);
      finishes[0]?.([1, 0, 1]);
      finishes[1]?.([2, 0, 1]);
    });
    expect(test.submit).toHaveBeenCalledTimes(2);
    expect(state.doc.globals['scenery.terrain']).toHaveLength(2);
  });
  it('long-presses a picked scenery item to remove it', async () => {
    vi.useFakeTimers();
    const test = harness();
    test.frame.pickAt = vi.fn().mockResolvedValue([{ id: entityId, kind: 'entity' }]);
    const state = test.session.getState();
    state.doc = { ...doc, entities: { [entityId]: { ...doc.entities[entityId]!, prefab: 'scenery:tree' } } };
    render(
      <GizmoOverlay
        frame={test.frame}
        manifest={manifest}
        session={test.session}
        snap={{ version: 1, enabled: false, grid: 1 }}
      />,
    );
    const canvas = screen.getByLabelText('Editor canvas');
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'touch', clientX: 20, clientY: 20 });
    await act(async () => {});
    act(() => vi.advanceTimersByTime(650));
    expect(test.submit).toHaveBeenCalledWith(
      expect.objectContaining({ patches: [expect.objectContaining({ op: 'remove', path: ['entities', entityId] })] }),
    );
  });

  it('does not delete when a touch moves or a late pick arrives after release', async () => {
    vi.useFakeTimers();
    const test = harness();
    let resolve!: (targets: TargetRef[]) => void;
    test.frame.pickAt = vi.fn(
      () =>
        new Promise<TargetRef[]>((done) => {
          resolve = done;
        }),
    );
    test.session.getState().doc = {
      ...doc,
      entities: { [entityId]: { ...doc.entities[entityId]!, prefab: 'scenery:tree' } },
    };
    render(
      <GizmoOverlay
        frame={test.frame}
        manifest={manifest}
        session={test.session}
        snap={{ version: 1, enabled: false, grid: 1 }}
      />,
    );
    const canvas = screen.getByLabelText('Editor canvas');
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'touch', clientX: 20, clientY: 20 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 40, clientY: 20 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    await act(async () => resolve([{ id: entityId, kind: 'entity' }]));
    act(() => vi.advanceTimersByTime(650));
    expect(test.submit).not.toHaveBeenCalled();
  });

  it('cancels long-press deletion when a second finger touches the canvas', async () => {
    vi.useFakeTimers();
    const test = harness();
    test.frame.pickAt = vi.fn().mockResolvedValue([{ id: entityId, kind: 'entity' }]);
    test.session.getState().doc = {
      ...doc,
      entities: { [entityId]: { ...doc.entities[entityId]!, prefab: 'scenery:tree' } },
    };
    render(
      <GizmoOverlay
        frame={test.frame}
        manifest={manifest}
        session={test.session}
        snap={{ version: 1, enabled: false, grid: 1 }}
      />,
    );
    const canvas = screen.getByLabelText('Editor canvas');
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'touch', clientX: 20, clientY: 20 });
    await act(async () => {});
    fireEvent.pointerDown(canvas, { pointerId: 2, pointerType: 'touch', clientX: 30, clientY: 30 });
    act(() => vi.advanceTimersByTime(650));
    expect(test.submit).not.toHaveBeenCalled();
  });

  it('drags a scenery item directly on the ground with touch', async () => {
    const test = harness();
    test.session.getState().doc = {
      ...doc,
      entities: { [entityId]: { ...doc.entities[entityId]!, prefab: 'scenery:tree' } },
    };
    test.frame.pickAt = vi.fn().mockResolvedValue([{ kind: 'entity', id: entityId }]);
    test.frame.project = vi.fn().mockResolvedValueOnce([1, 0, 1]).mockResolvedValueOnce([3, 0, 2]);
    render(
      <GizmoOverlay
        frame={test.frame}
        manifest={{ ...manifest, dimension: '3d', capabilities: ['editor.project'] }}
        session={test.session}
        snap={{ version: 1, enabled: true, grid: 1 }}
      />,
    );
    const canvas = screen.getByLabelText('Editor canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 60 } as DOMRect);
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 });
    await act(async () => {});
    fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: 'touch', clientX: 40, clientY: 30 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    await act(async () => {});
    expect(test.commitStroke).toHaveBeenCalledOnce();
    expect(test.commitStroke.mock.calls[0]?.[0][0].doc.entities[entityId].props.pose.position).toEqual([12, 10, 1]);
  });

  it('pinches and rotates a scenery item as one undoable stroke', async () => {
    const test = harness();
    test.session.getState().doc = {
      ...doc,
      entities: { [entityId]: { ...doc.entities[entityId]!, prefab: 'scenery:tree' } },
    };
    test.frame.pickAt = vi.fn().mockResolvedValue([{ kind: 'entity', id: entityId }]);
    render(
      <GizmoOverlay
        frame={test.frame}
        manifest={manifest}
        session={test.session}
        snap={{ version: 1, enabled: false, grid: 1 }}
      />,
    );
    const canvas = screen.getByLabelText('Editor canvas');
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 });
    await act(async () => {});
    fireEvent.pointerDown(canvas, { pointerId: 2, pointerType: 'touch', clientX: 20, clientY: 10 });
    fireEvent.pointerMove(canvas, { pointerId: 2, pointerType: 'touch', clientX: 10, clientY: 30 });
    fireEvent.pointerUp(canvas, { pointerId: 2, pointerType: 'touch' });
    expect(test.commitStroke).toHaveBeenCalledOnce();
    const changed = test.commitStroke.mock.calls[0]?.[0][0].doc.entities[entityId].props;
    expect(changed.scale).toEqual([2, 2, 2]);
    expect(changed.pose.rotationY).toBeCloseTo(90);
  });

  it('restores the design when a pinch is cancelled', async () => {
    const test = harness();
    test.session.getState().doc = {
      ...doc,
      entities: { [entityId]: { ...doc.entities[entityId]!, prefab: 'scenery:tree' } },
    };
    test.frame.pickAt = vi.fn().mockResolvedValue([{ kind: 'entity', id: entityId }]);
    render(
      <GizmoOverlay
        frame={test.frame}
        manifest={manifest}
        session={test.session}
        snap={{ version: 1, enabled: false, grid: 1 }}
      />,
    );
    const canvas = screen.getByLabelText('Editor canvas');
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 });
    await act(async () => {});
    fireEvent.pointerDown(canvas, { pointerId: 2, pointerType: 'touch', clientX: 20, clientY: 10 });
    fireEvent.pointerMove(canvas, { pointerId: 2, pointerType: 'touch', clientX: 30, clientY: 10 });
    fireEvent.pointerCancel(canvas, { pointerId: 2, pointerType: 'touch' });
    expect(test.commitStroke).not.toHaveBeenCalled();
    expect(test.frame.applyDesign).toHaveBeenLastCalledWith(4, test.session.getState().doc, []);
  });

  it('uses game projection for a 3D placement, including a quick release', async () => {
    const test = harness();
    test.frame.project = vi.fn().mockResolvedValue([2, 0, -1]);
    render(
      <GizmoOverlay
        activePrefab="skeleton"
        frame={test.frame}
        manifest={{ ...manifest, dimension: '3d', capabilities: ['editor.project'] }}
        session={test.session}
        snap={{ version: 1, enabled: true, grid: 1 }}
      />,
    );
    const canvas = screen.getByLabelText('Editor canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 60 } as DOMRect);
    fireEvent.pointerDown(canvas, { clientX: 25, clientY: 30, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 25, clientY: 30, pointerId: 1 });
    await act(async () => {});
    expect(test.frame.project).toHaveBeenCalledWith(0.25, 0.5);
    expect(test.frame.validatePlacement).toHaveBeenCalledWith('skeleton', { position: [2, 0, -1] });
    await act(async () => test.placement({ ok: true }));
    expect(test.submit).toHaveBeenCalledOnce();
  });

  it('places scenery in the scene level rather than the camera view', async () => {
    const test = harness();
    test.frame.project = vi.fn().mockResolvedValue([2, 0, -1]);
    render(
      <GizmoOverlay
        activePrefab="scenery:tree"
        frame={test.frame}
        manifest={{ ...manifest, view: 'iso', dimension: '3d', capabilities: ['editor.project'] }}
        session={test.session}
        snap={{ version: 1, enabled: false, grid: 1 }}
      />,
    );
    const canvas = screen.getByLabelText('Editor canvas');
    fireEvent.pointerDown(canvas, { clientX: 25, clientY: 30, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 25, clientY: 30, pointerId: 1 });
    await act(async () => {});
    await act(async () => test.placement({ ok: true }));
    expect(test.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        patches: [expect.objectContaining({ value: expect.objectContaining({ level: 'main' }) })],
      }),
    );
  });

  it('does not place a projected item after the pointer is cancelled', async () => {
    const test = harness();
    let finish!: (position: [number, number, number] | null) => void;
    test.frame.project = vi.fn(
      () =>
        new Promise<[number, number, number] | null>((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <GizmoOverlay
        activePrefab="skeleton"
        frame={test.frame}
        manifest={{ ...manifest, dimension: '3d', capabilities: ['editor.project'] }}
        session={test.session}
        snap={{ version: 1, enabled: true, grid: 1 }}
      />,
    );
    const canvas = screen.getByLabelText('Editor canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 60 } as DOMRect);
    fireEvent.pointerDown(canvas, { clientX: 25, clientY: 30, pointerId: 1 });
    fireEvent.pointerCancel(canvas, { pointerId: 1 });
    await act(async () => finish([2, 0, -1]));
    expect(test.frame.validatePlacement).not.toHaveBeenCalled();
    expect(test.submit).not.toHaveBeenCalled();
  });
  it('echoes a picked target as the session selection and editor.select acknowledgement', () => {
    const test = harness();
    render(
      <GizmoOverlay
        frame={test.frame}
        manifest={manifest}
        session={test.session}
        snap={{ version: 1, enabled: true, grid: 1 }}
      />,
    );
    const canvas = screen.getByLabelText('Editor canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, width: 100, height: 80 } as DOMRect);

    fireEvent.pointerDown(canvas, { clientX: 60, clientY: 60, pointerId: 1 });
    test.picked([{ id: entityId, kind: 'entity' }]);

    expect(test.frame.pick).toHaveBeenCalledWith(0.5, 0.5);
    expect(test.setSelection).toHaveBeenCalledWith([entityId]);
    expect(test.frame.select).toHaveBeenCalledWith([entityId]);
  });

  it('does not place an invalid ghost and submits exactly once after valid revalidation', async () => {
    vi.useFakeTimers();
    const test = harness();
    render(
      <GizmoOverlay
        activePrefab="skeleton"
        frame={test.frame}
        manifest={manifest}
        session={test.session}
        snap={{ version: 1, enabled: true, grid: 1 }}
      />,
    );
    const canvas = screen.getByLabelText('Editor canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 60 } as DOMRect);

    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
    await act(async () => {
      test.placement({ ok: false, reason: 'blocked' });
      await Promise.resolve();
    });
    expect(screen.getByRole('status')).toHaveAttribute('data-state', 'invalid');
    fireEvent.pointerUp(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
    expect(test.submit).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTimeAsync(70));
    fireEvent.pointerDown(canvas, { clientX: 20, clientY: 20, pointerId: 2 });
    fireEvent.pointerUp(canvas, { clientX: 20, clientY: 20, pointerId: 2 });
    await act(async () => {
      test.placement({ ok: true });
      await Promise.resolve();
    });

    expect(test.submit).toHaveBeenCalledOnce();
  });

  it('coalesces forty translate pointer events and exposes a matching bounded stepper', () => {
    const test = harness([entityId]);
    render(
      <GizmoOverlay
        frame={test.frame}
        manifest={manifest}
        session={test.session}
        snap={{ version: 1, enabled: false, grid: 1 }}
      />,
    );
    const canvas = screen.getByLabelText('Editor canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 60 } as DOMRect);
    const handle = screen.getByRole('button', { name: 'Move skeleton' });

    fireEvent.pointerDown(handle, { clientX: 10, clientY: 10, pointerId: 3 });
    for (let index = 1; index <= 40; index += 1) {
      fireEvent.pointerMove(canvas, { clientX: 10 + index, clientY: 10, pointerId: 3 });
    }
    fireEvent.pointerUp(canvas, { clientX: 50, clientY: 10, pointerId: 3 });

    expect(test.commitStroke).toHaveBeenCalledOnce();
    expect(test.commitStroke.mock.calls[0]?.[0]).toHaveLength(40);
    fireEvent.click(screen.getByRole('button', { name: 'Move skeleton backward' }));
    expect(test.submit).toHaveBeenCalledOnce();
  });

  it('moves 3D items by the projected ground delta even when released before projection finishes', async () => {
    const test = harness([entityId]);
    test.frame.project = vi.fn().mockResolvedValueOnce([1, 0, 1]).mockResolvedValueOnce([3, 0, 2]);
    render(
      <GizmoOverlay
        frame={test.frame}
        manifest={{ ...manifest, dimension: '3d', capabilities: ['editor.project'] }}
        session={test.session}
        snap={{ version: 1, enabled: true, grid: 1 }}
      />,
    );
    const canvas = screen.getByLabelText('Editor canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 60 } as DOMRect);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Move skeleton' }), {
      clientX: 10,
      clientY: 10,
      pointerId: 3,
    });
    fireEvent.pointerMove(canvas, { clientX: 50, clientY: 30, pointerId: 3 });
    fireEvent.pointerUp(canvas, { clientX: 50, clientY: 30, pointerId: 3 });
    await act(async () => {});
    expect(test.commitStroke).toHaveBeenCalledOnce();
    expect(test.commitStroke.mock.calls[0]?.[0][0].doc.entities[entityId].props.pose.position).toEqual([12, 10, 1]);
  });

  it('discards a cancelled drag and restores the authoritative design', () => {
    const test = harness([entityId]);
    render(
      <GizmoOverlay
        frame={test.frame}
        manifest={manifest}
        session={test.session}
        snap={{ version: 1, enabled: false, grid: 1 }}
      />,
    );
    const canvas = screen.getByLabelText('Editor canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 60 } as DOMRect);

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Move skeleton' }), {
      clientX: 10,
      clientY: 10,
      pointerId: 4,
    });
    fireEvent.pointerMove(canvas, { clientX: 20, clientY: 10, pointerId: 4 });
    fireEvent.pointerCancel(canvas, { pointerId: 4 });

    expect(test.commitStroke).not.toHaveBeenCalled();
    expect(test.frame.applyDesign).toHaveBeenLastCalledWith(4, doc, []);
  });
});
