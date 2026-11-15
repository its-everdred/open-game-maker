import type { PlayerSettings } from '@ogm/contracts/game';

type Pattern = 'light' | 'medium' | 'heavy' | number[];
const strengths = { light: 10, medium: 25, heavy: 50 };
const sharedLimiter: { nextPulse: number; enabled?: boolean } = { nextPulse: 0 };

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === 'ogm.settings' || event.key === null) sharedLimiter.enabled = readStoredPreference();
  });
}

/** Bound both the duration of a request and the frequency of accepted requests. */
export class HapticsController {
  constructor(private readonly limiter: { nextPulse: number; enabled?: boolean } = sharedLimiter) {
    this.limiter.enabled ??= readStoredPreference();
  }

  setSettings(settings: PlayerSettings): void {
    this.limiter.enabled = (settings.haptics ?? true) && !settings.reduceMotion;
  }

  pulse(pattern: Pattern): void {
    if (
      !this.limiter.enabled ||
      (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
    )
      return;
    const now = performance.now();
    if (now < this.limiter.nextPulse) return;
    const duration = typeof pattern === 'string' ? strengths[pattern] : pattern.reduce((sum, value) => sum + value, 0);
    this.limiter.nextPulse = now + Math.max(500, duration + 500);
    if (typeof navigator.vibrate === 'function')
      navigator.vibrate(typeof pattern === 'string' ? strengths[pattern] : pattern);
  }
}

function readStoredPreference(): boolean {
  try {
    const value: unknown = JSON.parse(localStorage.getItem('ogm.settings') ?? '{}');
    if (typeof value !== 'object' || value === null) return true;
    const settings = value as { haptics?: unknown; reduceMotion?: unknown };
    return settings.haptics !== false && settings.reduceMotion !== true;
  } catch {
    return true;
  }
}
