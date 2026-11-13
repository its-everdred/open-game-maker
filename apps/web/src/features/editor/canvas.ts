import type { GameManifest, Pose } from '@ogm/contracts/browser';

import type { SnapPrefs } from './SnapPrefs';

export type NormalizedPoint = { x: number; y: number };
export type GizmoKind = GameManifest['gizmos'][string][number];

type FrameRect = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;

export function normalizeFramePoint(clientX: number, clientY: number, frame: FrameRect): NormalizedPoint {
  if (frame.width <= 0 || frame.height <= 0) return { x: 0, y: 0 };
  return {
    x: clamp((clientX - frame.left) / frame.width, 0, 1),
    y: clamp((clientY - frame.top) / frame.height, 0, 1),
  };
}

export function placementPose(point: NormalizedPoint, manifest: GameManifest, snap: SnapPrefs): Pose {
  const { w, h } = manifest.presentation.minLogical;
  const x = snapped(point.x * w, snap);
  const depth = snapped(point.y * h, snap);
  return manifest.dimension === '2d'
    ? { position: [clamp(x, 0, w), clamp(depth, 0, h), 0] }
    : { position: [clamp(x, 0, w), 0, clamp(depth, 0, h)] };
}

export function projectedPose(position: [number, number, number], snap: SnapPrefs): Pose {
  return { position: position.map((value) => snapped(value, snap)) as [number, number, number] };
}

export function movePose(
  start: Pose,
  gizmo: GizmoKind,
  delta: NormalizedPoint,
  manifest: GameManifest,
  snap: SnapPrefs,
): Pose {
  const { w, h } = manifest.presentation.minLogical;
  const next = clonePose(start);
  if (gizmo === 'rotateYaw') {
    next.rotationY = round((start.rotationY ?? 0) + delta.x * 180, 0.001);
    return next;
  }
  if (gizmo === 'elevate') {
    next.position[1] = clamp(snapped(start.position[1] - delta.y * h, snap), 0, h);
    return next;
  }
  next.position[0] = clamp(snapped(start.position[0] + delta.x * w, snap), 0, w);
  const depthIndex = manifest.dimension === '2d' ? 1 : 2;
  next.position[depthIndex] = clamp(snapped(start.position[depthIndex] + delta.y * h, snap), 0, h);
  return next;
}

export function stepPose(
  start: Pose,
  gizmo: GizmoKind,
  direction: -1 | 1,
  manifest: GameManifest,
  snap: SnapPrefs,
): Pose | undefined {
  const next = clonePose(start);
  const distance = snap.grid;
  if (gizmo === 'rotateYaw') {
    next.rotationY = round((start.rotationY ?? 0) + direction * 15, 0.001);
  } else if (gizmo === 'elevate') {
    next.position[1] = clamp(start.position[1] + direction * distance, 0, manifest.presentation.minLogical.h);
  } else {
    const x = start.position[0] + direction * distance;
    next.position[0] = manifest.capabilities?.includes('editor.project')
      ? x
      : clamp(x, 0, manifest.presentation.minLogical.w);
  }
  return samePose(start, next) ? undefined : next;
}

export function poseFromProps(value: unknown): Pose {
  if (!isRecord(value) || !Array.isArray(value.position) || value.position.length !== 3) {
    return { position: [0, 0, 0] };
  }
  const position = value.position;
  if (!position.every((part) => typeof part === 'number' && Number.isFinite(part))) {
    return { position: [0, 0, 0] };
  }
  const rotationY = value.rotationY;
  return {
    position: [position[0] as number, position[1] as number, position[2] as number],
    ...(typeof rotationY === 'number' && Number.isFinite(rotationY) ? { rotationY } : {}),
  };
}

function snapped(value: number, prefs: SnapPrefs): number {
  return prefs.enabled ? round(Math.round(value / prefs.grid) * prefs.grid, 0.000001) : value;
}

function clonePose(pose: Pose): Pose {
  return { position: [...pose.position], ...(pose.rotationY === undefined ? {} : { rotationY: pose.rotationY }) };
}

function samePose(left: Pose, right: Pose): boolean {
  return left.rotationY === right.rotationY && left.position.every((value, index) => value === right.position[index]);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, precision: number): number {
  return Math.round(value / precision) * precision;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
