import type { Activity, BuildTimeline, Job, Rollup } from '@ogm/contracts';

export const adminActivities = [
  'asset_pipeline',
  'level_building',
  'gameplay_code',
  'animation_vfx',
  'audio',
  'ui_hud',
  'playtesting',
  'deploy_release',
  'writing',
] as const satisfies readonly Activity[];

export type AdminMe = {
  user: { id: string; email: string };
  family: {
    id: string;
    name: string;
    role: 'owner' | 'admin' | 'member';
    capability: 'creator' | 'player';
  } | null;
  platformRole: 'maintainer' | 'admin' | 'none';
};

export type AdminMember = {
  userId: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
  capability: 'creator' | 'player';
  joinedAt: string;
  dailyMicroUsd: number;
  remainingMicroUsd: number;
};

export type AllowListRole = 'player' | 'maker' | 'admin';

// One row of `GET /admin/users`: the instance sign-in allow list, not the family roster.
export type AdminAllowedUser = {
  email: string;
  role: AllowListRole;
  addedBy: string;
  addedAt: string;
  lastSignInAt: string | null;
  name?: string | null;
  weeklyBudget?: { newGames: number | null; edits: number | null };
};

export type AdminInvitation = {
  id: string;
  kind: 'member' | 'play' | 'room';
  email: string;
  capability: 'creator' | 'player' | null;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type AdminSettings = {
  familyId: string;
  resetZone: string;
  unitLabel: string;
  microUsdPerUnit: number;
  platformCapMicroUsd: number;
  slots: { new_game: number; edit: number };
  hardCapMultiplier: number;
  friendsAllowed: boolean;
};

export type AdminBudget = {
  familyDayMicroUsd: number;
  platformCapMicroUsd: number;
  resetsAt: string;
  unitLabel: string;
  microUsdPerUnit: number;
  slots: { new_game: number; edit: number };
  inUse: { new_game: number; edit: number };
  queued: string[];
  members: AdminMember[];
};

export type AdminGame = {
  id: string;
  ownerId: string;
  title: string;
  visibility: 'listed' | 'private';
  releaseState?: 'released' | 'coming_soon';
  repoVisibility: 'public' | 'private';
  createdAt: string;
  delistedAt: string | null;
};

export type IntakeDrop = {
  dropId: string;
  name: string;
  time: string;
  status: 'queued' | 'imported' | 'awaiting-license' | 'blocked' | 'duplicate';
  collection?: string | null;
  license?: string | null;
  confirmedBy?: string | null;
  date?: string | null;
  problems: number;
};

export type IntakeStatus = { drops: IntakeDrop[]; parseErrors: number };

export type AdminBuild = {
  job: Pick<Job, 'id' | 'kind' | 'state' | 'usageMicroUsd' | 'createdAt' | 'updatedAt' | 'terminalAt'>;
  game: Pick<AdminGame, 'id' | 'title' | 'ownerId' | 'visibility' | 'delistedAt'>;
  member: { userId: string; email: string | null };
  retries: number;
};

export type AdminBuildData = {
  builds: AdminBuild[];
  games: AdminGame[];
  members: AdminMember[];
};

export type RollupRow = { id: string; label: string; rollup: Rollup };
export type { BuildTimeline };
