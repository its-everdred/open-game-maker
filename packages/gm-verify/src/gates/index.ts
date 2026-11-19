export const GATE_CHECK_IDS = [
  'typecheck',
  'no-wall-clock-in-sim',
  'hook-present',
  'image-stretch',
  'boot',
  'ticks',
  'round-trip',
  'hud-still',
  'promises',
] as const;

export type GateCheckId = (typeof GATE_CHECK_IDS)[number];

export type GateCheck = {
  id: GateCheckId;
  ok: boolean;
  detail?: string;
  file?: string;
  line?: number;
};

export interface GateResult {
  gate: 'L0' | 'L1';
  ok: boolean;
  durationMs: number;
  checks: GateCheck[];
  /** Path to report.json when a browser ran. */
  report?: string;
}

export { runL0, checkHookPresence, type L0CheckId, type RunL0Options } from './l0-static.js';
export { runL1, runPromiseSpecs, type RunL1Options } from './l1-smoke.js';
export { scanFile, scanRepo, type WallClockFinding } from './no-wall-clock.js';
export { scanPackageImports, scanWallClock, type ImportFinding } from './test-only.js';
