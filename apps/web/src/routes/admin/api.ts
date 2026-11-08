import { useQuery } from '@tanstack/react-query';

import type { BuildTimeline, Rollup } from '@ogm/contracts';

import { queryClient } from '../../app/query';
import { api, ApiError } from '../../lib/api/client';
import type {
  AdminAllowedUser,
  AdminBudget,
  AdminBuild,
  AdminBuildData,
  AdminGame,
  AdminInvitation,
  AdminMe,
  AdminMember,
  AdminSettings,
  IntakeStatus,
  RollupRow,
} from './types';

export const adminKeys = {
  me: () => ['admin', 'me'] as const,
  members: () => ['admin', 'members'] as const,
  invites: () => ['admin', 'invites'] as const,
  users: () => ['admin', 'users'] as const,
  settings: () => ['admin', 'settings'] as const,
  budget: () => ['admin', 'budget'] as const,
  gameplay: () => ['admin', 'gameplay'] as const,
  games: () => ['admin', 'games'] as const,
  intake: () => ['admin', 'intake'] as const,
  builds: () => ['admin', 'builds'] as const,
  timeline: (jobId: string) => ['admin', 'timeline', jobId] as const,
  rollups: (scope: 'game' | 'member', days: number) => ['admin', 'rollups', scope, days] as const,
};

export async function adminRequest<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  try {
    return await api<T>(path, init);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      await queryClient.invalidateQueries({ queryKey: adminKeys.me() });
    }
    throw error;
  }
}

export async function invalidateAdmin(...keys: readonly (readonly unknown[])[]): Promise<void> {
  await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}

export function useAdminMe(enabled = true) {
  return useQuery({ queryKey: adminKeys.me(), queryFn: () => adminRequest<AdminMe>('/me'), retry: false, enabled });
}

export function useMembers() {
  return useQuery({
    queryKey: adminKeys.members(),
    queryFn: () => adminRequest<{ members: AdminMember[] }>('/admin/members'),
    retry: false,
  });
}

export function useAllowedUsers() {
  return useQuery({
    queryKey: adminKeys.users(),
    queryFn: () => adminRequest<{ users: AdminAllowedUser[] }>('/admin/users'),
    retry: false,
  });
}

export function useInvites() {
  return useQuery({
    queryKey: adminKeys.invites(),
    queryFn: () => adminRequest<{ invitations: AdminInvitation[] }>('/admin/invites'),
    retry: false,
  });
}

export function useAdminSettings() {
  return useQuery({
    queryKey: adminKeys.settings(),
    queryFn: () => adminRequest<AdminSettings>('/admin/settings'),
    retry: false,
  });
}

export function useAdminBudget() {
  return useQuery({
    queryKey: adminKeys.budget(),
    queryFn: () => adminRequest<AdminBudget>('/admin/budget'),
    retry: false,
  });
}

export function useIntake() {
  return useQuery({
    queryKey: adminKeys.intake(),
    queryFn: () => adminRequest<IntakeStatus>('/admin/intake'),
    retry: false,
  });
}

export function useAdminBuilds() {
  return useQuery({ queryKey: adminKeys.builds(), queryFn: fetchAdminBuilds, retry: false });
}

export function useBuildTimeline(jobId: string) {
  return useQuery({
    queryKey: adminKeys.timeline(jobId),
    queryFn: () => adminRequest<BuildTimeline>(`/analytics/builds/${encodeURIComponent(jobId)}/timeline`),
    enabled: jobId !== '',
    retry: false,
  });
}

export function useRollups(scope: 'game' | 'member', days: number, items: { id: string; label: string }[]) {
  const ids = items.map(({ id }) => id).join(',');
  return useQuery({
    queryKey: [...adminKeys.rollups(scope, days), ids],
    enabled: items.length > 0,
    initialData: items.length === 0 ? [] : undefined,
    retry: false,
    queryFn: async (): Promise<RollupRow[]> => {
      const to = new Date();
      const from = new Date(to.getTime() - days * 86_400_000);
      return Promise.all(
        items.map(async ({ id, label }) => {
          const query = new URLSearchParams({ scope, id, from: from.toISOString(), to: to.toISOString() });
          return { id, label, rollup: await adminRequest<Rollup>(`/analytics/rollups?${query}`) };
        }),
      );
    },
  });
}

export async function fetchAdminBuilds(): Promise<AdminBuildData> {
  const [{ builds }, { games }, { members }] = await Promise.all([
    adminRequest<{ builds: AdminBuild[] }>('/admin/builds'),
    adminRequest<{ games: AdminGame[] }>('/admin/games?includeDelisted=1'),
    adminRequest<{ members: AdminMember[] }>('/admin/members'),
  ]);
  return { builds, games, members };
}
