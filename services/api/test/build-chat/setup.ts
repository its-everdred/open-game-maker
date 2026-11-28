import type { AiurClient } from '@ogm/aiur-client';
import type { Principal } from '@ogm/contracts';
import { schema } from '@ogm/db';

import type { ChatJob } from '../../src/app/registry.js';
import { makeApp, makeDeps } from '../helpers.js';

export const FIXTURES = new URL('./fixtures/', import.meta.url);
export const JOB_ID = 'j_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e6f';
export const OTHER_JOB_ID = 'j_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e70';
const FAMILY = 'f_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e02';

export const users = {
  owner: {
    kind: 'user',
    userId: 'u_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e03',
    familyId: FAMILY,
    platformRole: 'none',
    capability: 'creator',
  },
  sibling: {
    kind: 'user',
    userId: 'u_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e04',
    familyId: FAMILY,
    platformRole: 'none',
    capability: 'creator',
  },
  player: {
    kind: 'user',
    userId: 'u_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e05',
    familyId: FAMILY,
    platformRole: 'none',
    capability: 'player',
  },
  maintainer: {
    kind: 'user',
    userId: 'u_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e06',
    familyId: FAMILY,
    platformRole: 'maintainer',
    capability: 'creator',
  },
} as const satisfies Record<string, Principal>;

export function chatJob(overrides: Partial<ChatJob> = {}): ChatJob {
  return {
    jobId: JOB_ID,
    gameId: 'g_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e01',
    familyId: FAMILY,
    ownerId: users.owner.userId,
    kind: 'feature',
    state: 'running',
    aiur: { daemonSlug: 'game-1', ticket: '142' },
    ...overrides,
  };
}

// A mutable job table standing in for OGM-013's.
export function jobTable(...jobs: ChatJob[]) {
  const byId = new Map(jobs.map((job) => [job.jobId, job]));
  return {
    byId,
    directory: {
      get: async (jobId: string) => byId.get(jobId) ?? null,
      active: async () => [...byId.values()].filter((job) => job.aiur !== null),
    },
  };
}

export type FakeAiur = Pick<AiurClient, 'message' | 'progress' | 'decisions' | 'decision' | 'decide'>;

export function makeChatDeps(jobs = jobTable(chatJob()), client?: FakeAiur, seedGame = true) {
  const deps = makeDeps();
  const now = '2026-11-01T00:00:00.000Z';
  if (seedGame) {
    deps.db
      .insert(schema.families)
      .values({ id: FAMILY, name: 'Family', ownerUserId: users.owner.userId, createdAt: now })
      .run();
    deps.db
      .insert(schema.games)
      .values({
        id: chatJob().gameId,
        familyId: FAMILY,
        ownerId: users.owner.userId,
        title: 'Game',
        visibility: 'private',
        repoVisibility: 'private',
        createdAt: now,
      })
      .run();
  }
  deps.registry.chatJobs = jobs.directory;
  if (client) deps.registry.aiurClientFor = () => client;
  return deps;
}

export async function makeChatApp(jobs = jobTable(chatJob()), client?: FakeAiur, seedGame = true) {
  const result = await makeApp(makeChatDeps(jobs, client, seedGame));
  result.deps.registry.principalResolvers.push(async (c) => {
    const user = c.req.header('x-test-user') as keyof typeof users | undefined;
    return user && user in users ? users[user] : null;
  });
  return { ...result, jobs };
}

export const as = (user: keyof typeof users) => ({ 'x-test-user': user });
