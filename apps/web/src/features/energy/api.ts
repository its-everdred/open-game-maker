import { useMutation, useQuery } from '@tanstack/react-query';

import type {
  EnergyAdminView,
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

export function useEnergyAdmin(enabled: boolean) {
  return useQuery({
    queryKey: energyKeys.admin(),
    queryFn: () => api<EnergyAdminView>('/energy/admin'),
    enabled,
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

export const WINDOW_LABELS: Record<EnergyWindowName, string> = {
  day: 'Today',
  week: 'This week',
  month: 'This month',
};

const WINDOW_PHRASES: Record<EnergyWindowName, string> = { day: 'today', week: 'this week', month: 'this month' };

// A refused build, said in terms of the build the player asked for.
export function energyRefusalText(window: EnergyWindowName | undefined): string | undefined {
  return window ? `This build needs more Energy than is left ${WINDOW_PHRASES[window]}.` : undefined;
}

// The ring shows what is left in the tightest window that has a limit; null when no window is known.
export function energyLeftPercent(view: EnergyView | undefined): number | null {
  const used = view?.windows.flatMap(({ usedPercent }) => (usedPercent === null ? [] : [usedPercent])) ?? [];
  return used.length === 0 ? null : 100 - Math.max(...used);
}
