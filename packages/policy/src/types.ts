export const ACTIONS = [
  'game.create',
  'game.edit',
  'game.publish',
  'game.play',
  'game.fork',
  'job.create',
  'job.cancel',
  'job.edit',
  'member.invite',
  'admin.budget.set',
  'report.file',
  'admin.members.manage',
  'admin.settings.set',
  'admin.analytics.read',
  'game.delist',
  'game.flag_abuse',
  'report.view',
  'admin.gameplay.set',
] as const;

export type Action = (typeof ACTIONS)[number];

export type Actor = {
  userId: string;
  platformRole: 'maintainer' | 'admin' | 'none';
  capability: 'creator' | 'player';
  familyId: string;
};

export type Resource = {
  gameId?: string;
  ownerId?: string;
  familyId?: string;
  visibility?: 'listed' | 'private';
  inviteKind?: 'member' | 'play' | 'room';
  targetRole?: 'owner' | 'admin' | 'member';
  granted?: boolean;
  audit?: boolean;
};

export type Authorization = { ok: true; reason?: 'audited' } | { ok: false; reason: string };
