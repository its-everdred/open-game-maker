import { useQuery } from '@tanstack/react-query';

import type { ChangeNote, Release } from '@ogm/contracts/browser';

import { queryClient } from '../../../app/query';
import { api } from '../../../lib/api/client';
import { versionKeys } from '../versions/api';

export type PublishPreview = {
  version: string;
  changelog: { summary: string; items: ChangeNote[] };
};

export type RollbackPreview = { affectedSaves: number | null };
export type PublishCheckRecord = {
  id: string;
  gitSha: string;
  artifactSha256: string | null;
  testArtifactSha256: string | null;
  buildId: string | null;
  surface: 'game' | 'app';
  sizes: string[];
  checks: { name: string; result: 'passed' | 'failed' }[];
  result: 'passed' | 'failed';
  publishResult: 'pending' | 'published' | 'skipped' | 'failed';
  createdAt: string;
};

export const releaseKeys = {
  releases: (gameId: string) => ['game', gameId, 'releases'] as const,
  published: (gameId: string) => ['game', gameId, 'published'] as const,
  publishPreview: (gameId: string, buildId: string) => ['game', gameId, 'publish-preview', buildId] as const,
  rollbackPreview: (gameId: string, releaseId: string) => ['game', gameId, 'rollback-preview', releaseId] as const,
};

export function useReleases(gameId: string) {
  return useQuery({
    queryKey: releaseKeys.releases(gameId),
    queryFn: () => listReleases(gameId),
    enabled: gameId !== '',
  });
}

export function usePublishChecks(gameId: string) {
  return useQuery({
    queryKey: ['game', gameId, 'publish-checks'],
    queryFn: async () =>
      (await api<{ records: PublishCheckRecord[] }>(`/games/${segment(gameId)}/publish-checks`)).records,
    enabled: gameId !== '',
  });
}

export function usePublishPreview(gameId: string, buildId: string | undefined) {
  return useQuery({
    queryKey: releaseKeys.publishPreview(gameId, buildId ?? ''),
    queryFn: () => getPublishPreview(gameId, buildId!),
    enabled: gameId !== '' && buildId !== undefined,
  });
}

export function useRollbackPreview(gameId: string, releaseId: string | undefined) {
  return useQuery({
    queryKey: releaseKeys.rollbackPreview(gameId, releaseId ?? ''),
    queryFn: () => getRollbackPreview(gameId, releaseId!),
    enabled: gameId !== '' && releaseId !== undefined,
  });
}

export async function listReleases(gameId: string): Promise<Release[]> {
  const { releases } = await api<{ releases: Release[] }>(`/games/${segment(gameId)}/releases`);
  return releases;
}

export function getPublishPreview(gameId: string, buildId: string): Promise<PublishPreview> {
  return api(`/games/${segment(gameId)}/publish-preview?buildId=${segment(buildId)}`);
}

export async function publishRelease(
  gameId: string,
  buildId: string,
  changelog: PublishPreview['changelog'],
): Promise<Release> {
  const release = await api<Release>(`/games/${segment(gameId)}/publish`, {
    method: 'POST',
    json: { buildId, changelog },
  });
  await refreshReleaseData(gameId);
  return release;
}

export function getRollbackPreview(gameId: string, releaseId: string): Promise<RollbackPreview> {
  return api(`/games/${segment(gameId)}/rollback-preview?releaseId=${segment(releaseId)}`);
}

export async function rollbackRelease(gameId: string, releaseId: string): Promise<Release> {
  const release = await api<Release>(`/games/${segment(gameId)}/rollback`, {
    method: 'POST',
    json: { releaseId },
  });
  await refreshReleaseData(gameId);
  return release;
}

export async function refreshReleaseData(gameId: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: releaseKeys.releases(gameId) }),
    queryClient.invalidateQueries({ queryKey: releaseKeys.published(gameId) }),
    queryClient.invalidateQueries({ queryKey: versionKeys.branches(gameId) }),
    queryClient.invalidateQueries({ queryKey: versionKeys.builds(gameId) }),
  ]);
}

function segment(value: string): string {
  return encodeURIComponent(value);
}
