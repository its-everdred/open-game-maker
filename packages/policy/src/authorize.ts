import type { Action, Actor, Authorization, Resource } from './types.js';

const ownerActions = new Set<Action>(['game.edit', 'game.publish', 'job.edit']);
const adminActions = new Set<Action>([
  'admin.budget.set',
  'admin.members.manage',
  'admin.settings.set',
  'admin.analytics.read',
  'game.flag_abuse',
  'admin.gameplay.set',
]);

const allowed = (): Authorization => ({ ok: true });
const denied = (reason: string): Authorization => ({ ok: false, reason });

export function authorize(actor: Actor, action: Action, resource: Resource = {}): Authorization {
  if (resource.familyId !== undefined && resource.familyId !== actor.familyId) return denied('cross_family');
  if (ownerActions.has(action) && resource.ownerId === undefined) return denied('owner_required');

  if (actor.platformRole === 'maintainer') {
    if (ownerActions.has(action) && resource.ownerId !== actor.userId) {
      return resource.audit ? { ok: true, reason: 'audited' } : denied('audit_required');
    }
    return allowed();
  }

  if (action === 'game.create') return actor.capability === 'creator' ? allowed() : denied('creator_required');

  if (ownerActions.has(action)) {
    return resource.ownerId === actor.userId ? allowed() : denied('not_owner');
  }

  if (action === 'job.create') {
    if (actor.capability !== 'creator') return denied('creator_required');
    return resource.ownerId === actor.userId ? allowed() : denied('not_owner');
  }

  if (action === 'job.cancel') return resource.ownerId === actor.userId ? allowed() : denied('not_owner');

  if (adminActions.has(action)) return actor.platformRole === 'admin' ? allowed() : denied('admin_required');

  if (action === 'game.delist') {
    return actor.platformRole === 'admin' || resource.ownerId === actor.userId ? allowed() : denied('not_owner');
  }

  if (action === 'member.invite') {
    if (resource.inviteKind === undefined) return denied('invite_kind_required');
    if (actor.platformRole === 'admin') return allowed();
    return actor.capability === 'creator' && (resource.inviteKind === 'play' || resource.inviteKind === 'room')
      ? allowed()
      : denied('not_allowed');
  }

  if (action === 'game.play') {
    if (resource.visibility === 'listed') return allowed();
    if (resource.visibility !== 'private') return denied('visibility_required');
    return resource.ownerId === actor.userId || resource.granted === true ? allowed() : denied('private_game');
  }

  if (action === 'game.fork') {
    if (resource.ownerId === actor.userId) return allowed();
    return actor.capability === 'creator' && resource.visibility === 'listed' ? allowed() : denied('not_allowed');
  }

  if (action === 'report.file') return allowed();
  if (action === 'report.view') return actor.platformRole === 'admin' ? allowed() : denied('admin_required');
  return denied('not_allowed');
}
