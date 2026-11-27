import { useMutation, useQuery } from '@tanstack/react-query';

import type {
  EnergyAdminView,
  EnergyCapsUpdate,
  EnergyLimits,
  EnergyPreference,
  EnergyView,
  EnergyWindowName,
} from '@ogm/contracts/browser';

import { queryClient } from '../../app/query';
import { api } from '../../lib/api/client';

export const energyKeys = { view: () => ['energy'] as const, admin: () => ['energy', 'admin'] as const };

const REFRESH_MS = 60_000;

export function useEnergy(enabled = true) {
  return useQuery({
    queryKey: energyKeys.view(),
    queryFn: () => api<EnergyView>('/energy'),
    enabled,
    refetchInterval: REFRESH_MS,
  });
}

export function useEnergyAdmin() {
  return useQuery({
    queryKey: energyKeys.admin(),
    queryFn: () => api<EnergyAdminView>('/energy/admin'),
    retry: false,
  });
}

export function useSetPreference() {
  return useMutation({
    mutationFn: (preference: EnergyPreference) =>
      api<EnergyView>('/energy/preference', { method: 'PUT', json: { preference } }),
    onSuccess: (view) => {
      queryClient.setQueryData(energyKeys.view(), view);
      return queryClient.invalidateQueries({ queryKey: energyKeys.admin() });
    },
  });
}

export function useSaveLimits() {
  return useMutation({
    mutationFn: (limits: EnergyLimits) => api<EnergyAdminView>('/energy/admin/limits', { method: 'PUT', json: limits }),
    onSuccess: (view) => {
      queryClient.setQueryData(energyKeys.admin(), view);
      return queryClient.invalidateQueries({ queryKey: energyKeys.view(), exact: true });
    },
  });
}

export function useSaveCaps() {
  return useMutation({
    mutationFn: (caps: EnergyCapsUpdate) => api<EnergyAdminView>('/energy/admin/caps', { method: 'PUT', json: caps }),
    onSuccess: (view) => queryClient.setQueryData(energyKeys.admin(), view),
  });
}

export const WINDOW_LABELS: Record<EnergyWindowName, string> = {
  day: 'Today',
  week: 'This week',
  month: 'This month',
};

const WINDOW_PHRASES: Record<EnergyWindowName, string> = { day: 'today', week: 'this week', month: 'this month' };

// A refused build, said in terms of the build the player asked for.
export function energyRefusalText(
  window: EnergyWindowName | undefined,
  resetsAt?: string,
  reason?: 'weekly_user',
): string | undefined {
  if (!window) return undefined;
  const reset = resetsAt
    ? ` The limit resets ${new Date(resetsAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}.`
    : '';
  return reason === 'weekly_user'
    ? `The interim weekly job limit is exhausted.${reset}`
    : `This build exceeds the overall build budget ${WINDOW_PHRASES[window]}.${reset}`;
}

// The ring shows what is left in the tightest known window or provider reading; null when none is known.
export function energyLeftPercent(view: EnergyView | undefined): number | null {
  const used = (view?.sources ?? [])
    .filter(({ id }) => /^(claude|codex):/.test(id) || id === 'fal')
    .flatMap(({ usedPercent }) => (usedPercent === null ? [] : [usedPercent]));
  return used.length === 0 ? null : Math.round(100 - Math.max(...used));
}
