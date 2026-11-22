export type FocusPoint = { x: number; y: number; z?: number };

export function createFocusFollower(smoothing: number, deadzone: number) {
  let current: FocusPoint | undefined;

  return {
    step(target: FocusPoint, dtMs: number): FocusPoint {
      if (!current) {
        current = { ...target };
        return { ...current };
      }
      const smoothing01 = Math.max(0, Math.min(1, smoothing));
      const alpha = 1 - Math.pow(1 - smoothing01, Math.max(0, dtMs) / (1000 / 60));
      const next: FocusPoint = { x: current.x, y: current.y };
      for (const axis of ['x', 'y', 'z'] as const) {
        if (axis === 'z' && current.z === undefined && target.z === undefined) continue;
        const from = current[axis] ?? 0;
        const to = target[axis] ?? from;
        const delta = to - from;
        const distance = Math.abs(delta);
        if (distance <= deadzone) {
          next[axis] = from;
          continue;
        }
        const movement = distance * alpha;
        const remaining = distance - movement;
        next[axis] = from + Math.sign(delta) * (remaining <= deadzone ? distance : movement);
      }
      current = next;
      return { ...current };
    },
  };
}
