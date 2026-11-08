import type { EnergyAdminView, EnergyLevel, EnergyPreference, EnergyView, EnergyWindowName } from '@ogm/contracts';

import type { EnergySnapshot } from './source.js';

const WINDOWS: readonly EnergyWindowName[] = ['day', 'week', 'month'];
const SERVICES = ['voice', 'images'] as const;
// Below this share left in the tightest known limit, Energy is Limited.
const LIMITED_BELOW = 0.25;

function usedPercent(used: number | null, limit: number | null): number | null {
  if (used === null || limit === null) return null;
  if (limit === 0) return 100;
  return Math.min(100, Math.round((used / limit) * 100));
}

// The tightest known limit decides the status; with no known limit it is unknown, not healthy.
export function energyLevel(snapshot: EnergySnapshot): EnergyLevel {
  const left = [...WINDOWS, ...SERVICES].flatMap((name) => {
    const used = snapshot.usage[name];
    const limit = snapshot.limits[name];
    if (used === null || limit === null) return [];
    return [limit === 0 ? 0 : 1 - used / limit];
  });
  if (left.length === 0) return 'unknown';
  const tightest = Math.min(...left);
  if (tightest <= 0) return 'critical';
  return tightest < LIMITED_BELOW ? 'limited' : 'healthy';
}

export function playerView(snapshot: EnergySnapshot, preference: EnergyPreference): EnergyView {
  return {
    level: energyLevel(snapshot),
    preference,
    windows: WINDOWS.map((window) => ({
      window,
      usedPercent: usedPercent(snapshot.usage[window], snapshot.limits[window]),
      resetsAt: snapshot.resetsAt[window],
    })),
    services: SERVICES.map((service) => ({
      service,
      usedPercent: usedPercent(snapshot.usage[service], snapshot.limits[service]),
    })),
  };
}

export function adminView(snapshot: EnergySnapshot, preference: EnergyPreference): EnergyAdminView {
  return {
    ...playerView(snapshot, preference),
    limits: snapshot.limits,
    usage: snapshot.usage,
    resources: snapshot.resources,
  };
}

// The first window a build of `amountMicroUsd` would overrun, with what that window has left; null when it fits all.
export function energyBlock(
  snapshot: EnergySnapshot,
  amountMicroUsd: number,
): { window: EnergyWindowName; remainingMicroUsd: number; resetsAt: string } | null {
  for (const window of WINDOWS) {
    const limit = snapshot.limits[window];
    if (limit === null) continue;
    const used = snapshot.usage[window];
    if (used + amountMicroUsd > limit) {
      return { window, remainingMicroUsd: Math.max(0, limit - used), resetsAt: snapshot.resetsAt[window] };
    }
  }
  return null;
}
