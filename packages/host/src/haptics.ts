import type { PlayerSettings } from '@ogm/contracts/game';

type Pattern = 'light' | 'medium' | 'heavy' | number[];
const strengths = { light: 10, medium: 25, heavy: 50 };

/** Bound both the duration of a request and the frequency of accepted requests. */
export class HapticsController {
  private enabled = true;
  private nextPulse = 0;

  setSettings(settings: PlayerSettings): void {
    this.enabled = (settings.haptics ?? true) && !settings.reduceMotion;
  }

  pulse(pattern: Pattern): void {
    if (!this.enabled || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches))
      return;
    const now = performance.now();
    if (now < this.nextPulse) return;
    const duration = typeof pattern === 'string' ? strengths[pattern] : pattern.reduce((sum, value) => sum + value, 0);
    this.nextPulse = now + Math.max(500, duration + 500);
    if (typeof navigator.vibrate === 'function')
      navigator.vibrate(typeof pattern === 'string' ? strengths[pattern] : pattern);
  }
}
