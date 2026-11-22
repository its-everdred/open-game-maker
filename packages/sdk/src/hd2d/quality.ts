export type Hd2dQuality = 'off' | 'low' | 'high';

export interface DeviceProfile {
  /** `window.devicePixelRatio`. */
  dpr: number;
  isMobile: boolean;
  /** Whether a WebGL context is available; without one every HD-2D effect is off. */
  webgl: boolean;
}

/** Above this pixel ratio a desktop drops to low: every effect buffer is paid per device pixel. */
const HIGH_DPR = 2;

/** The starting tier for a device: off without WebGL, low on phones and very dense screens, high otherwise. */
export function pickQuality({ dpr, isMobile, webgl }: DeviceProfile): Hd2dQuality {
  if (!webgl) return 'off';
  if (isMobile || dpr > HIGH_DPR) return 'low';
  return 'high';
}

export interface FrameBudget {
  /** A frame slower than this counts against the budget. */
  frameMs: number;
  /** Net slow frames (each fast frame forgives one) before the tier drops one step. */
  slowFrames: number;
}

/**
 * 30 fps, and about two seconds of it. #1225 measured headless desktop at ~46 fps with effects off and ~8 fps
 * with lighting and focus on, so a tier that cannot hold 30 fps is dropped, not left to stutter.
 */
export const DEFAULT_FRAME_BUDGET: FrameBudget = { frameMs: 1000 / 30, slowFrames: 60 };

/** A gap this long is a pause (a hidden tab, a debugger, a stepped clock), not a slow frame; 1 fps still counts. */
const PAUSE_MS = 1000;

const STEP_DOWN: Record<Hd2dQuality, Hd2dQuality> = { high: 'low', low: 'off', off: 'off' };

/** Counts slow frames and answers the tier to run next: one step lower once the budget is spent, never higher. */
export function createFrameGovernor(budget: FrameBudget = DEFAULT_FRAME_BUDGET) {
  let slow = 0;
  return {
    sample(frameMs: number, quality: Hd2dQuality): Hd2dQuality {
      if (!(frameMs > 0) || frameMs > PAUSE_MS) return quality;
      slow = frameMs > budget.frameMs ? slow + 1 : Math.max(0, slow - 1);
      if (slow < budget.slowFrames) return quality;
      slow = 0;
      return STEP_DOWN[quality];
    },
    reset(): void {
      slow = 0;
    },
  };
}
