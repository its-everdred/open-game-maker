import { useEffect, useRef, useState } from 'react';
import type { StoreApi } from 'zustand/vanilla';

import type { Entity, GameManifest, PlacementResult, Pose, TargetRef } from '@ogm/contracts/browser';

import { FocusZone } from '../../lib/input';
import {
  movePose,
  gizmoLabel,
  gizmoSymbol,
  normalizeFramePoint,
  placementPose,
  projectedPose,
  entityPose,
  stepPose,
  type GizmoKind,
} from './canvas';
import { EDITOR_FOCUS_ZONES } from './focus';
import type { GameFrameController } from './frame';
import type { EditorSessionState } from './session';
import type { SnapPrefs } from './SnapPrefs';
import { useTerrainStroke } from './terrain-stroke';
import {
  createEntityIntent,
  createStableId,
  deleteEntityIntent,
  updateEntityPoseIntent,
  updateSceneryTransformIntent,
  type EditorIntent,
} from './transactions';

type Ghost = { prefab: string; pose: Pose; result?: PlacementResult };
type Drag = {
  pointerId: number;
  startX: number;
  startY: number;
  entity: Entity;
  gizmo: GizmoKind;
  intents: EditorIntent[];
  doc: EditorSessionState['doc'];
  projection?: {
    origin: Promise<[number, number, number] | null>;
    sequence: number;
    pending: boolean;
    released: boolean;
    cancelled: boolean;
  };
};

type GizmoOverlayProps = {
  activePrefab?: string;
  frame: GameFrameController;
  manifest: GameManifest;
  session: StoreApi<EditorSessionState>;
  snap: SnapPrefs;
  onRequestPlacement?(prefab: string, point: { x: number; y: number }, path?: Array<{ x: number; y: number }>): void;
  onRequestDelete?(entity: Entity): void;
  onRequestTransform?(
    entity: Entity,
    gizmo: GizmoKind,
    target: { point?: { x: number; y: number }; direction?: -1 | 1 },
  ): void;
  allowReadOnlyRequests?: boolean;
};

const VALIDATION_INTERVAL_MS = 1000 / 15;

export function GizmoOverlay({
  activePrefab,
  frame,
  manifest,
  session,
  snap,
  onRequestPlacement,
  onRequestDelete,
  onRequestTransform,
  allowReadOnlyRequests = false,
}: GizmoOverlayProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<Ghost | undefined>(undefined);
  const dragRef = useRef<Drag | undefined>(undefined);
  const terrain = useTerrainStroke(
    frame,
    session,
    activePrefab,
    manifest.capabilities?.includes('editor.project') ?? false,
  );
  const touchesRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<
    | {
        ids: [number, number];
        distance: number;
        angle: number;
        entity: Entity;
        doc: EditorSessionState['doc'];
        intents: EditorIntent[];
      }
    | undefined
  >(undefined);
  const holdRef = useRef<
    | {
        pointerId: number;
        x: number;
        y: number;
        picked?: string;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined
  >(undefined);
  const validationAtRef = useRef(-Infinity);
  const validationTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingValidationRef = useRef<Ghost | undefined>(undefined);
  const dropRequestedRef = useRef(false);
  const projectionSequence = useRef(0);
  const requestPointerRef = useRef<number | undefined>(undefined);
  const requestPathRef = useRef<Array<{ x: number; y: number }>>([]);
  const requestTransformRef = useRef<{ entity: Entity; gizmo: GizmoKind } | undefined>(undefined);
  const requestInterruptedRef = useRef(false);
  const projectingRef = useRef(false);
  const [ghost, setGhost] = useState<Ghost>();
  const [anchor, setAnchor] = useState<{ id: string; x: number; y: number }>();
  const selectedId = session.getState().selection[0];
  const selected = selectedId === undefined ? undefined : session.getState().doc.entities[selectedId];
  const gizmos = selected === undefined ? [] : (manifest.gizmos[selected.prefab] ?? []);

  useEffect(() => {
    const stopPicked = frame.onPicked((targets) => {
      receivePicked(targets, session, frame, setAnchor);
    });
    const stopScreen = frame.onScreen((position) => {
      if ('offscreen' in position) {
        setAnchor((current) => (current?.id === position.id ? undefined : current));
      } else {
        setAnchor(position);
      }
    });
    return () => {
      stopPicked();
      stopScreen();
    };
  }, [frame, manifest, session]);

  useEffect(
    () => () => {
      if (holdRef.current) clearTimeout(holdRef.current.timer);
      holdRef.current = undefined;
      touchesRef.current.clear();
      pinchRef.current = undefined;
      if (validationTimerRef.current !== undefined) clearTimeout(validationTimerRef.current);
      validationTimerRef.current = undefined;
      pendingValidationRef.current = undefined;
      ghostRef.current = undefined;
      projectionSequence.current += 1;
      projectingRef.current = false;
      dropRequestedRef.current = false;
      if (dragRef.current?.projection) dragRef.current.projection.cancelled = true;
      dragRef.current = undefined;
      requestPointerRef.current = undefined;
      requestTransformRef.current = undefined;
      requestInterruptedRef.current = false;
    },
    [activePrefab, frame],
  );

  const validateGhost = (candidate: Ghost) => {
    void frame.validatePlacement(candidate.prefab, candidate.pose).then((result) => {
      if (ghostRef.current !== candidate) return;
      const validated = { ...candidate, result };
      ghostRef.current = validated;
      setGhost(validated);
      if (!dropRequestedRef.current) return;
      dropRequestedRef.current = false;
      if (result.ok) commitPlacement(validated, manifest, session, setGhost, ghostRef);
    });
  };

  const requestValidation = (next: Ghost) => {
    const now = performance.now();
    const remaining = validationAtRef.current + VALIDATION_INTERVAL_MS - now;
    if (remaining <= 0) {
      validationAtRef.current = now;
      validateGhost(next);
      return;
    }
    pendingValidationRef.current = next;
    if (validationTimerRef.current !== undefined) return;
    validationTimerRef.current = setTimeout(() => {
      validationTimerRef.current = undefined;
      const pending = pendingValidationRef.current;
      pendingValidationRef.current = undefined;
      if (pending === undefined) return;
      validationAtRef.current = performance.now();
      validateGhost(pending);
    }, remaining);
  };

  const updateGhost = (clientX: number, clientY: number) => {
    const surface = surfaceRef.current;
    if (activePrefab === undefined || surface === null || dropRequestedRef.current) return;
    const point = normalizeFramePoint(clientX, clientY, surface.getBoundingClientRect());
    const sequence = ++projectionSequence.current;
    const accept = (pose: Pose | null) => {
      if (sequence !== projectionSequence.current) return;
      projectingRef.current = false;
      if (pose === null) {
        dropRequestedRef.current = false;
        return;
      }
      const next: Ghost = { prefab: activePrefab, pose };
      ghostRef.current = next;
      setGhost(next);
      requestValidation(next);
    };
    if (manifest.capabilities?.includes('editor.project')) {
      projectingRef.current = true;
      ghostRef.current = undefined;
      setGhost(undefined);
      void frame
        .project(point.x, point.y, activePrefab)
        .then((position) => accept(position ? projectedPose(position, snap) : null))
        .catch(() => accept(null));
    } else {
      accept(placementPose(point, manifest, snap));
    }
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (session.getState().readOnly && !(allowReadOnlyRequests && onRequestPlacement)) return;
    if (onRequestPlacement && activePrefab !== undefined) {
      if (requestPointerRef.current !== undefined) {
        requestInterruptedRef.current = true;
        return;
      }
      requestInterruptedRef.current = false;
      requestPointerRef.current = event.pointerId;
      requestPathRef.current = [
        normalizeFramePoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect()),
      ];
      capturePointer(event.currentTarget, event.pointerId);
      return;
    }
    if (event.pointerType === 'touch') {
      touchesRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touchesRef.current.size > 1) {
        const held = holdRef.current;
        const state = session.getState();
        const entity = held?.picked ? state.doc.entities[held.picked] : undefined;
        if (holdRef.current) clearTimeout(holdRef.current.timer);
        holdRef.current = undefined;
        if (touchesRef.current.size === 2 && entity?.prefab.startsWith('scenery:')) {
          if (dragRef.current?.projection) dragRef.current.projection.cancelled = true;
          dragRef.current = undefined;
          frame.applyDesign(state.headRev, state.doc, []);
          const ids = [...touchesRef.current.keys()] as [number, number];
          const first = touchesRef.current.get(ids[0])!;
          const second = touchesRef.current.get(ids[1])!;
          pinchRef.current = {
            ids,
            distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
            angle: Math.atan2(second.y - first.y, second.x - first.x),
            entity,
            doc: state.doc,
            intents: [],
          };
          capturePointer(event.currentTarget, event.pointerId);
        }
        return;
      }
    }
    capturePointer(event.currentTarget, event.pointerId);
    if (terrain.down(event)) return;
    if (activePrefab !== undefined) {
      dropRequestedRef.current = false;
      updateGhost(event.clientX, event.clientY);
      return;
    }
    if (session.getState().tool === 'select') {
      const point = normalizeFramePoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());
      if (event.pointerType === 'touch') {
        if (holdRef.current) clearTimeout(holdRef.current.timer);
        const pointerId = event.pointerId;
        const held = {
          pointerId,
          x: event.clientX,
          y: event.clientY,
          picked: undefined as string | undefined,
          timer: setTimeout(() => {
            if (holdRef.current !== held || !held.picked) return;
            const state = session.getState();
            const entity = state.doc.entities[held.picked];
            if (
              entity?.prefab.startsWith('scenery:') &&
              (!state.readOnly || (allowReadOnlyRequests && onRequestDelete))
            ) {
              if (state.readOnly) onRequestDelete?.(entity);
              else void state.submit(deleteEntityIntent(state.doc, entity.id, `Removed ${entity.prefab}`));
              state.setSelection([]);
              frame.select([]);
            }
            holdRef.current = undefined;
          }, 650),
        };
        holdRef.current = held;
        void frame
          .pickAt(point.x, point.y)
          .then((targets) => {
            if (holdRef.current !== held) return;
            held.picked = targets.find((target) => target.kind === 'entity')?.id;
            receivePicked(targets, session, frame, setAnchor);
          })
          .catch(() => {});
      } else {
        frame.pick(point.x, point.y);
      }
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (requestPointerRef.current !== undefined) {
      if (requestPointerRef.current === event.pointerId && activePrefab?.startsWith('scenery-band:')) {
        if (requestPathRef.current.length >= 255)
          requestPathRef.current = requestPathRef.current.filter((_, index) => index % 2 === 0);
        requestPathRef.current.push(
          normalizeFramePoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect()),
        );
      }
      return;
    }
    if (terrain.move(event)) return;
    if (activePrefab?.startsWith('scenery-band:')) return;
    if (touchesRef.current.has(event.pointerId))
      touchesRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pinch = pinchRef.current;
    if (pinch?.ids.includes(event.pointerId)) {
      const first = touchesRef.current.get(pinch.ids[0]);
      const second = touchesRef.current.get(pinch.ids[1]);
      if (!first || !second) return;
      const factor = Math.max(0.1, Math.min(10, Math.hypot(second.x - first.x, second.y - first.y) / pinch.distance));
      const originalScale =
        Array.isArray(pinch.entity.props.scale) &&
        pinch.entity.props.scale.length === 3 &&
        pinch.entity.props.scale.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0)
          ? (pinch.entity.props.scale as [number, number, number])
          : [1, 1, 1];
      const pose = entityPose(pinch.entity.props);
      pose.rotationY =
        (pose.rotationY ?? 0) + ((Math.atan2(second.y - first.y, second.x - first.x) - pinch.angle) * 180) / Math.PI;
      const scale = originalScale.map((n) => n * factor) as [number, number, number];
      const intent = updateSceneryTransformIntent(
        pinch.doc,
        pinch.entity.id,
        pose,
        scale,
        `Transformed ${pinch.entity.prefab}`,
      );
      pinch.intents.push(intent);
      pinch.doc = intent.doc;
      frame.applyDesign(session.getState().headRev, intent.doc, intent.patches);
      return;
    }
    const held = holdRef.current;
    if (held && event.pointerId === held.pointerId && Math.hypot(event.clientX - held.x, event.clientY - held.y) > 12) {
      clearTimeout(held.timer);
      const state = session.getState();
      const entity = held.picked === undefined ? undefined : state.doc.entities[held.picked];
      if (
        !dragRef.current &&
        entity?.prefab.startsWith('scenery:') &&
        manifest.capabilities?.includes('editor.project')
      ) {
        const point = normalizeFramePoint(held.x, held.y, event.currentTarget.getBoundingClientRect());
        dragRef.current = {
          pointerId: held.pointerId,
          startX: held.x,
          startY: held.y,
          entity,
          gizmo: 'translate',
          intents: [],
          doc: state.doc,
          projection: {
            origin: frame.project(point.x, point.y, entity.prefab).catch(() => null),
            sequence: 0,
            pending: false,
            released: false,
            cancelled: false,
          },
        };
      }
    }
    const drag = dragRef.current;
    if (drag !== undefined && event.pointerId === drag.pointerId) {
      const rect = event.currentTarget.getBoundingClientRect();
      if (drag.projection) {
        const projection = drag.projection;
        if (projection.released) return;
        const sequence = ++projection.sequence;
        projection.pending = true;
        const point = normalizeFramePoint(event.clientX, event.clientY, rect);
        void Promise.all([projection.origin, frame.project(point.x, point.y, drag.entity.prefab)])
          .then(([origin, target]) => {
            if (projection.cancelled || sequence !== projection.sequence) return;
            projection.pending = false;
            if (origin && target) {
              const initial = entityPose(drag.entity.props);
              const painted =
                Boolean(session.getState().doc.globals['scenery.backdrop']) &&
                manifest.palette.items.some(
                  (item) => item.prefab === drag.entity.prefab && item.tag === 'painted-sprite',
                );
              const pose = projectedPose(
                manifest.dimension === '2d' || painted
                  ? [
                      initial.position[0] + target[0] - origin[0],
                      initial.position[1] + target[1] - origin[1],
                      initial.position[2],
                    ]
                  : [
                      initial.position[0] + target[0] - origin[0],
                      initial.position[1],
                      initial.position[2] + target[2] - origin[2],
                    ],
                snap,
              );
              if (manifest.dimension === '2d' || painted) pose.position[2] = initial.position[2];
              else pose.position[1] = initial.position[1];
              if (initial.rotationY !== undefined) pose.rotationY = initial.rotationY;
              const intent = updateEntityPoseIntent(drag.doc, drag.entity.id, pose, `Moved ${drag.entity.prefab}`);
              drag.intents.push(intent);
              drag.doc = intent.doc;
              frame.applyDesign(session.getState().headRev, intent.doc, intent.patches);
            }
            if (projection.released && drag.intents.length > 0) {
              void session.getState().commitStroke(drag.intents, `Moved ${drag.entity.prefab}`);
            }
            if (projection.released && dragRef.current === drag) dragRef.current = undefined;
          })
          .catch(() => {
            if (projection.cancelled || sequence !== projection.sequence) return;
            projection.pending = false;
            if (projection.released) {
              if (drag.intents.length > 0)
                void session.getState().commitStroke(drag.intents, `Moved ${drag.entity.prefab}`);
              if (dragRef.current === drag) dragRef.current = undefined;
            }
          });
        return;
      }
      const pose = movePose(
        entityPose(drag.entity.props),
        drag.gizmo,
        { x: (event.clientX - drag.startX) / rect.width, y: (event.clientY - drag.startY) / rect.height },
        manifest,
        snap,
      );
      const intent = updateEntityPoseIntent(drag.doc, drag.entity.id, pose, `Moved ${drag.entity.prefab}`);
      drag.intents.push(intent);
      drag.doc = intent.doc;
      frame.applyDesign(session.getState().headRev, intent.doc, intent.patches);
      return;
    }
    if (activePrefab !== undefined) updateGhost(event.clientX, event.clientY);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (requestPointerRef.current !== undefined) {
      if (requestPointerRef.current !== event.pointerId) return;
      requestPointerRef.current = undefined;
      if (!requestInterruptedRef.current && (!session.getState().readOnly || allowReadOnlyRequests)) {
        const point = normalizeFramePoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());
        const transform = requestTransformRef.current;
        if (transform && onRequestTransform) onRequestTransform(transform.entity, transform.gizmo, { point });
        else if (activePrefab && onRequestPlacement) {
          if (activePrefab.startsWith('scenery-band:')) {
            requestPathRef.current.push(point);
            onRequestPlacement(activePrefab, point, requestPathRef.current);
          } else onRequestPlacement(activePrefab, point);
        }
      }
      requestTransformRef.current = undefined;
      requestPathRef.current = [];
      requestInterruptedRef.current = false;
      return;
    }
    if (onRequestPlacement) {
      if (holdRef.current?.pointerId === event.pointerId) clearTimeout(holdRef.current.timer);
      holdRef.current = undefined;
      return;
    }
    touchesRef.current.delete(event.pointerId);
    if (terrain.up(event)) return;
    const pinch = pinchRef.current;
    if (pinch?.ids.includes(event.pointerId)) {
      pinchRef.current = undefined;
      if (pinch.intents.length)
        void session.getState().commitStroke(pinch.intents, `Transformed ${pinch.entity.prefab}`);
      return;
    }
    if (holdRef.current?.pointerId === event.pointerId) {
      clearTimeout(holdRef.current.timer);
      holdRef.current = undefined;
    }
    const drag = dragRef.current;
    if (drag !== undefined && event.pointerId === drag.pointerId) {
      if (drag.projection?.pending) {
        drag.projection.released = true;
        return;
      }
      dragRef.current = undefined;
      if (drag.intents.length > 0) void session.getState().commitStroke(drag.intents, `Moved ${drag.entity.prefab}`);
      return;
    }
    if (activePrefab === undefined) return;
    const current = ghostRef.current;
    if (current?.result === undefined) {
      dropRequestedRef.current = current !== undefined || projectingRef.current;
      return;
    }
    if (current.result.ok) commitPlacement(current, manifest, session, setGhost, ghostRef);
  };

  const onPointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    if (requestPointerRef.current === event.pointerId) {
      requestPointerRef.current = undefined;
      requestTransformRef.current = undefined;
      requestPathRef.current = [];
    }
    touchesRef.current.delete(event.pointerId);
    terrain.cancel(event);
    if (pinchRef.current?.ids.includes(event.pointerId)) {
      pinchRef.current = undefined;
      const state = session.getState();
      frame.applyDesign(state.headRev, state.doc, []);
    }
    if (holdRef.current?.pointerId === event.pointerId) {
      clearTimeout(holdRef.current.timer);
      holdRef.current = undefined;
    }
    const drag = dragRef.current;
    if (drag !== undefined && event.pointerId === drag.pointerId) {
      dragRef.current = undefined;
      if (drag.projection) drag.projection.cancelled = true;
      const state = session.getState();
      frame.applyDesign(state.headRev, state.doc, []);
    }
    dropRequestedRef.current = false;
    projectionSequence.current += 1;
    projectingRef.current = false;
    pendingValidationRef.current = undefined;
    if (validationTimerRef.current !== undefined) clearTimeout(validationTimerRef.current);
    validationTimerRef.current = undefined;
    ghostRef.current = undefined;
    setGhost(undefined);
  };

  const beginGizmo = (event: React.PointerEvent<HTMLButtonElement>, entity: Entity, gizmo: GizmoKind) => {
    event.stopPropagation();
    if (session.getState().readOnly) {
      if (allowReadOnlyRequests && onRequestTransform) {
        requestPointerRef.current = event.pointerId;
        requestInterruptedRef.current = false;
        requestTransformRef.current = { entity, gizmo };
        capturePointer(event.currentTarget, event.pointerId);
      }
      return;
    }
    if (dragRef.current?.projection) dragRef.current.projection.cancelled = true;
    capturePointer(event.currentTarget, event.pointerId);
    const surface = surfaceRef.current;
    const point = surface
      ? normalizeFramePoint(event.clientX, event.clientY, surface.getBoundingClientRect())
      : undefined;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      entity,
      gizmo,
      intents: [],
      doc: session.getState().doc,
      ...(gizmo === 'translate' && point && manifest.capabilities?.includes('editor.project')
        ? {
            projection: {
              origin: frame.project(point.x, point.y, entity.prefab).catch(() => null),
              sequence: 0,
              pending: false,
              released: false,
              cancelled: false,
            },
          }
        : {}),
    };
  };

  const step = (entity: Entity, gizmo: GizmoKind, direction: -1 | 1) => {
    if (session.getState().readOnly) {
      if (allowReadOnlyRequests && onRequestTransform) onRequestTransform(entity, gizmo, { direction });
      return;
    }
    const pose = stepPose(entityPose(entity.props), gizmo, direction, manifest, snap);
    if (pose === undefined) return;
    void session
      .getState()
      .submit(updateEntityPoseIntent(session.getState().doc, entity.id, pose, `Moved ${entity.prefab}`));
  };

  return (
    <FocusZone id={EDITOR_FOCUS_ZONES.canvas} className="editor-canvas-overlay">
      <div
        ref={surfaceRef}
        className="editor-canvas-surface"
        aria-label="Editor canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {ghost ? <GhostView ghost={ghost} manifest={manifest} /> : null}
        {selected
          ? gizmos.map((gizmo) => (
              <div
                className="gizmo-controls"
                key={gizmo}
                style={anchorStyle(anchor?.id === selected.id ? anchor : undefined)}
              >
                <button
                  type="button"
                  className="gizmo-handle tap-secondary"
                  aria-label={`${gizmoLabel(gizmo)} ${selected.prefab}`}
                  onPointerDown={(event) => beginGizmo(event, selected, gizmo)}
                >
                  {gizmoSymbol(gizmo)}
                </button>
                <button
                  type="button"
                  className="gizmo-step tap-secondary"
                  aria-label={`${gizmoLabel(gizmo)} ${selected.prefab} backward`}
                  onClick={() => step(selected, gizmo, -1)}
                >
                  −
                </button>
                <button
                  type="button"
                  className="gizmo-step tap-secondary"
                  aria-label={`${gizmoLabel(gizmo)} ${selected.prefab} forward`}
                  onClick={() => step(selected, gizmo, 1)}
                >
                  +
                </button>
              </div>
            ))
          : null}
      </div>
    </FocusZone>
  );
}

function commitPlacement(
  ghost: Ghost,
  manifest: GameManifest,
  session: StoreApi<EditorSessionState>,
  setGhost: (ghost: Ghost | undefined) => void,
  ghostRef: React.RefObject<Ghost | undefined>,
): void {
  const entity: Entity = {
    id: createStableId('e_'),
    prefab: ghost.prefab,
    level: ghost.prefab.startsWith('scenery:') ? 'main' : manifest.view,
    origin: 'creator',
    props: { pose: ghost.pose },
  };
  void session.getState().submit(createEntityIntent(session.getState().doc, entity, `Placed ${ghost.prefab}`));
  ghostRef.current = undefined;
  setGhost(undefined);
}

function receivePicked(
  targets: TargetRef[],
  session: StoreApi<EditorSessionState>,
  frame: GameFrameController,
  setAnchor: (anchor: { id: string; x: number; y: number } | undefined) => void,
): void {
  const ids = targets.filter((target) => target.kind === 'entity').map((target) => target.id);
  session.getState().setSelection(ids);
  const first = targets.find((target) => target.id === ids[0] && target.bounds !== undefined);
  setAnchor(
    first?.bounds === undefined
      ? undefined
      : { id: first.id, x: first.bounds.x + first.bounds.w / 2, y: first.bounds.y + first.bounds.h / 2 },
  );
  frame.select(ids);
}

function GhostView({ ghost, manifest }: { ghost: Ghost; manifest: GameManifest }) {
  const position = ghost.pose.position;
  const depth = position[manifest.dimension === '2d' ? 1 : 2];
  const { w, h } = manifest.presentation.minLogical;
  const state = ghost.result?.ok === false ? 'invalid' : ghost.result?.ok === true ? 'valid' : 'checking';
  return (
    <div
      className="placement-ghost"
      data-state={state}
      role="status"
      title={ghost.result?.ok === false ? ghost.result.reason : undefined}
      style={{ left: `${(position[0] / w) * 100}%`, top: `${(depth / h) * 100}%` }}
    >
      {ghost.prefab}
    </div>
  );
}

function anchorStyle(anchor: { x: number; y: number } | undefined): React.CSSProperties {
  return anchor === undefined ? { left: '50%', top: '50%' } : { left: anchor.x, top: anchor.y };
}

function capturePointer(element: HTMLElement, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // Pointer capture is optional in embedded and test browsers.
  }
}
