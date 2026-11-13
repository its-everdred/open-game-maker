import { useEffect, useRef } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import { normalizeFramePoint } from './canvas';
import type { GameFrameController } from './frame';
import type { EditorSessionState } from './session';
import { createIntent, createStableId } from './transactions';

type Point = [number, number, number];
type Stroke = {
  pointerId: number;
  kind: 'grass' | 'path' | 'water';
  x: number;
  y: number;
  points: Array<Promise<Point | null>>;
  cancelled: boolean;
  released: boolean;
};
type Pointer = React.PointerEvent<HTMLDivElement>;

export function useTerrainStroke(
  frame: GameFrameController,
  session: StoreApi<EditorSessionState>,
  activePrefab: string | undefined,
  canProject: boolean,
) {
  const ref = useRef<Stroke | undefined>(undefined);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
      if (ref.current) ref.current.cancelled = true;
      ref.current = undefined;
    },
    [frame, session],
  );
  useEffect(
    () => () => {
      if (ref.current && !ref.current.released) {
        ref.current.cancelled = true;
        ref.current = undefined;
      }
    },
    [activePrefab, canProject],
  );
  const addPoint = (stroke: Stroke, event: Pointer) => {
    const point = normalizeFramePoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());
    stroke.points.push(frame.project(point.x, point.y).catch(() => null));
    stroke.x = event.clientX;
    stroke.y = event.clientY;
  };
  return {
    down(event: Pointer): boolean {
      if (!activePrefab?.startsWith('scenery-band:')) return false;
      const kind = activePrefab.slice('scenery-band:'.length);
      if (canProject && (kind === 'grass' || kind === 'path' || kind === 'water')) {
        if (ref.current && !ref.current.released) ref.current.cancelled = true;
        const stroke: Stroke = {
          pointerId: event.pointerId,
          kind,
          x: event.clientX,
          y: event.clientY,
          points: [],
          cancelled: false,
          released: false,
        };
        addPoint(stroke, event);
        ref.current = stroke;
      }
      return true;
    },
    move(event: Pointer): boolean {
      const stroke = ref.current;
      if (stroke?.pointerId !== event.pointerId) return false;
      if (!stroke.released && Math.hypot(event.clientX - stroke.x, event.clientY - stroke.y) >= 8)
        addPoint(stroke, event);
      return true;
    },
    up(event: Pointer): boolean {
      const stroke = ref.current;
      if (stroke?.pointerId !== event.pointerId) return false;
      if (stroke.released) return true;
      if (Math.hypot(event.clientX - stroke.x, event.clientY - stroke.y) >= 8) addPoint(stroke, event);
      stroke.released = true;
      const currentGeneration = generation.current;
      const projected = Promise.all(stroke.points);
      queue.current = queue.current
        .then(async () => {
          const results = await projected;
          if (ref.current === stroke) ref.current = undefined;
          if (stroke.cancelled || currentGeneration !== generation.current) return;
          const points = results.filter((point): point is Point => point !== null);
          if (points.length < 2 || points.every((point) => point[0] === points[0]![0] && point[2] === points[0]![2]))
            return;
          const state = session.getState();
          if (state.readOnly) return;
          const settings = state.doc.globals['scenery.settings'];
          const fallback =
            settings && typeof settings === 'object' && !Array.isArray(settings)
              ? (settings as { terrain?: unknown }).terrain
              : undefined;
          const terrain = state.doc.globals['scenery.terrain'] ?? fallback;
          if (!Array.isArray(terrain)) return;
          const value = [...terrain, { id: createStableId('band_'), kind: stroke.kind, points, width: 1 }];
          await state.submit(
            createIntent(
              state.doc,
              [{ op: 'set', control: 'scenery.terrain', targets: 'global', value }],
              `Painted ${stroke.kind}`,
            ),
          );
        })
        .catch(() => undefined);
      return true;
    },
    cancel(event: Pointer): void {
      if (ref.current?.pointerId === event.pointerId) {
        ref.current.cancelled = true;
        ref.current = undefined;
      }
    },
  };
}
