import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';

import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';

import { daemonPaths, unitName } from '@ogm/builder';
import { schema } from '@ogm/db';
import { authorize, type Action, type Actor } from '@ogm/policy';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import {
  actorFromPrincipal,
  removeMember,
  requireAuthorization,
  setCapability,
  setRole,
} from '../accounts/families.js';
import { HttpError } from '../app/errors.js';
import { requirePrincipal } from '../app/principal.js';
import type { ApiBindings } from '../app/types.js';
import { parseBody, parseQuery } from '../app/validate.js';
import { markOpened } from '../auth/mail-admin-inbox.js';
import { allowanceRemaining } from '../budget/allowance.js';
import { getBudgetSettings } from '../budget/settings.js';
import { findGame, findGameForFamily, gameResponse } from '../games/games.js';
import { registerExistingGame } from '../games/register.js';
import { invitationResponse } from '../invites/invites.js';
import {
  budgetDefaults,
  budgetOverview,
  familyMember,
  familyRecipients,
  memberRows,
  requireMayManage,
  settingsResponse,
} from './family.js';
import { familyBuilds } from './builds.js';
import { readIntake } from './intake-status.js';
import {
  FlagGameAbuseBody,
  type GameAbuseFlag,
  PatchMemberBody,
  PatchSettingsBody,
  PutAllowanceBody,
  RegisterGameBody,
} from './shapes.js';

export const prefix = '/api/v1/admin';

const flag = z.enum(['0', '1']).optional();

// Every route acts on the caller's own family; no route takes a family id. Without an `ownerId`,
// `game.delist` is admin-only, so a game's owner cannot relist what an admin delisted.
function admin(c: Context<ApiBindings>, action: Action): Actor {
  const actor = actorFromPrincipal(requirePrincipal(c, ['user']));
  requireAuthorization(authorize(actor, action, { familyId: actor.familyId }));
  return actor;
}

function allowanceResponse(c: Context<ApiBindings>, familyId: string, userId: string) {
  const deps = c.get('deps');
  return {
    userId,
    familyId,
    ...allowanceRemaining({ db: deps.db, familyId, userId, now: new Date(), defaults: budgetDefaults(deps) }),
  };
}

function budgetChanged(c: Context<ApiBindings>, familyId: string, userIds: string[]): void {
  for (const userId of userIds) c.get('deps').events.emit('budget.changed', { familyId, userId });
}

const routes = new Hono<ApiBindings>()
  .get('/members', async (c) => {
    const actor = admin(c, 'admin.members.manage');
    return c.json({ members: await memberRows(c.get('deps'), actor.familyId, new Date()) });
  })
  .patch('/members/:userId', async (c) => {
    const actor = admin(c, 'admin.members.manage');
    const deps = c.get('deps');
    const target = familyMember(deps, actor.familyId, c.req.param('userId'));
    requireMayManage(deps, actor, target);
    const body = await parseBody(c, PatchMemberBody);
    if (body.role) setRole(deps.db, actor.familyId, target.userId, body.role);
    if (body.capability) setCapability(deps.db, actor.familyId, target.userId, body.capability);
    const updated = familyMember(deps, actor.familyId, target.userId);
    return c.json({ userId: updated.userId, role: updated.role, capability: updated.capability });
  })
  .delete('/members/:userId', (c) => {
    const actor = admin(c, 'admin.members.manage');
    const deps = c.get('deps');
    const target = familyMember(deps, actor.familyId, c.req.param('userId'));
    requireMayManage(deps, actor, target);
    removeMember(deps.db, actor.familyId, target.userId);
    return c.body(null, 204);
  })
  .get('/invites', (c) => {
    const actor = admin(c, 'admin.members.manage');
    const invitations = c
      .get('deps')
      .db.select()
      .from(schema.invitations)
      .where(eq(schema.invitations.familyId, actor.familyId))
      .orderBy(desc(schema.invitations.createdAt))
      .all();
    return c.json({ invitations: invitations.map(invitationResponse) });
  })
  .delete('/invites/:id', (c) => {
    const actor = admin(c, 'admin.members.manage');
    const { db } = c.get('deps');
    const found = and(eq(schema.invitations.id, c.req.param('id')), eq(schema.invitations.familyId, actor.familyId));
    if (!db.select({ id: schema.invitations.id }).from(schema.invitations).where(found).get()) {
      throw new HttpError(404, 'invite_not_found');
    }
    db.update(schema.invitations)
      .set({ revokedAt: new Date().toISOString() })
      .where(and(found, isNull(schema.invitations.revokedAt)))
      .run();
    return c.body(null, 204);
  })
  .get('/settings', (c) => {
    const actor = admin(c, 'admin.settings.set');
    return c.json(settingsResponse(c.get('deps'), actor.familyId));
  })
  .patch('/settings', async (c) => {
    const actor = admin(c, 'admin.settings.set');
    const deps = c.get('deps');
    const body = await parseBody(c, PatchSettingsBody);
    const familyId = actor.familyId;
    const current = getBudgetSettings(deps.db, familyId, budgetDefaults(deps));
    const stored = deps.db
      .select({ platformCapMicroUsd: schema.familyBudgetSettings.platformCapMicroUsd })
      .from(schema.familyBudgetSettings)
      .where(eq(schema.familyBudgetSettings.familyId, familyId))
      .get();
    const row = {
      familyId,
      resetZone: body.resetZone ?? current.resetZone,
      unitLabel: body.unitLabel ?? current.unitLabel,
      microUsdPerUnit: body.microUsdPerUnit ?? current.microUsdPerUnit,
      // An unset cap follows the members' allowances; only an explicit value pins it.
      platformCapMicroUsd: body.platformCapMicroUsd ?? stored?.platformCapMicroUsd ?? null,
      slotsNewGame: body.slots?.new_game ?? current.slots.new_game,
      slotsEdit: body.slots?.edit ?? current.slots.edit,
      hardCapMultiplier: current.hardCapMultiplier,
    };
    deps.db.transaction((tx) => {
      tx.insert(schema.familyBudgetSettings)
        .values(row)
        .onConflictDoUpdate({ target: schema.familyBudgetSettings.familyId, set: row })
        .run();
      if (body.friendsAllowed !== undefined) {
        tx.update(schema.families)
          .set({ friendsAllowed: body.friendsAllowed })
          .where(eq(schema.families.id, familyId))
          .run();
      }
    });
    const members = deps.db
      .select({ userId: schema.familyMembers.userId })
      .from(schema.familyMembers)
      .where(eq(schema.familyMembers.familyId, familyId))
      .all();
    budgetChanged(
      c,
      familyId,
      members.map((member) => member.userId),
    );
    return c.json(settingsResponse(deps, familyId));
  })
  .get('/allowances', (c) => {
    const actor = admin(c, 'admin.budget.set');
    const members = c
      .get('deps')
      .db.select({ userId: schema.familyMembers.userId })
      .from(schema.familyMembers)
      .where(eq(schema.familyMembers.familyId, actor.familyId))
      .all();
    return c.json({ allowances: members.map((member) => allowanceResponse(c, actor.familyId, member.userId)) });
  })
  .put('/allowances/:userId', async (c) => {
    const actor = admin(c, 'admin.budget.set');
    const deps = c.get('deps');
    const target = familyMember(deps, actor.familyId, c.req.param('userId'));
    const body = await parseBody(c, PutAllowanceBody);
    deps.db
      .insert(schema.allowances)
      .values({ familyId: actor.familyId, userId: target.userId, dailyMicroUsd: body.dailyMicroUsd })
      .onConflictDoUpdate({
        target: [schema.allowances.familyId, schema.allowances.userId],
        set: { dailyMicroUsd: body.dailyMicroUsd },
      })
      .run();
    budgetChanged(c, actor.familyId, [target.userId]);
    return c.json(allowanceResponse(c, actor.familyId, target.userId));
  })
  .get('/budget', async (c) => {
    const actor = admin(c, 'admin.budget.set');
    return c.json(await budgetOverview(c.get('deps'), actor.familyId, new Date()));
  })
  .get('/games', (c) => {
    const actor = admin(c, 'game.delist');
    const query = parseQuery(c, z.object({ includeDelisted: flag }));
    const family = eq(schema.games.familyId, actor.familyId);
    const games = c
      .get('deps')
      .db.select()
      .from(schema.games)
      .where(query.includeDelisted === '1' ? family : and(family, isNull(schema.games.delistedAt)))
      .orderBy(desc(schema.games.createdAt))
      .all();
    return c.json({ games: games.map(gameResponse) });
  })
  .get('/games/:id/early-access', (c) => {
    const actor = admin(c, 'admin.members.manage');
    const db = c.get('deps').db;
    const game = findGameForFamily(db, c.req.param('id'), actor.familyId);
    return c.json({
      userIds: db
        .select({ userId: schema.gameEarlyAccess.userId })
        .from(schema.gameEarlyAccess)
        .where(eq(schema.gameEarlyAccess.gameId, game.id))
        .all()
        .map((row) => row.userId),
    });
  })
  .put('/games/:id/early-access/:userId', (c) => {
    const actor = admin(c, 'admin.members.manage');
    const deps = c.get('deps');
    const game = findGameForFamily(deps.db, c.req.param('id'), actor.familyId);
    const member = familyMember(deps, actor.familyId, c.req.param('userId'));
    deps.db
      .insert(schema.gameEarlyAccess)
      .values({ gameId: game.id, userId: member.userId })
      .onConflictDoNothing()
      .run();
    return c.body(null, 204);
  })
  .delete('/games/:id/early-access/:userId', (c) => {
    const actor = admin(c, 'admin.members.manage');
    const deps = c.get('deps');
    const game = findGameForFamily(deps.db, c.req.param('id'), actor.familyId);
    const member = familyMember(deps, actor.familyId, c.req.param('userId'));
    deps.db
      .delete(schema.gameEarlyAccess)
      .where(and(eq(schema.gameEarlyAccess.gameId, game.id), eq(schema.gameEarlyAccess.userId, member.userId)))
      .run();
    return c.body(null, 204);
  })
  // Register a game whose repository already exists — a game living in an Open-Games monorepo — so the next game in
  // that repository takes this path instead of a hand-edited row. The row names the repository and the game's
  // `games/<slug>` folder in it; no provisioner runs and no repository or folder is created. The daemon block links
  // the game to the aiur instance already building that repository.
  .post('/games/import', async (c) => {
    const actor = admin(c, 'game.create');
    const deps = c.get('deps');
    const body = await parseBody(c, RegisterGameBody);
    const ownerId = body.ownerId ?? actor.userId;
    const member = deps.db
      .select({ userId: schema.familyMembers.userId })
      .from(schema.familyMembers)
      .where(and(eq(schema.familyMembers.familyId, actor.familyId), eq(schema.familyMembers.userId, ownerId)))
      .get();
    if (!member) throw new HttpError(404, 'member_not_found');
    // The instance's unit and env file follow the builder's `ogm-aiur@<repository>` convention, so a registration that
    // only names the port and checkout still lands on the daemon row the fleet and the Commands poller read.
    const instance = body.repo.name.toLowerCase();
    const unit = body.daemon.unit ?? unitName(instance);
    const envFile = body.daemon.envFile ?? daemonPaths(homedir(), instance).envFile;
    const game = registerExistingGame(deps.db, {
      familyId: actor.familyId,
      ownerId,
      title: body.title,
      repo: body.repo,
      daemon: { ...body.daemon, unit, envFile },
      ...(body.visibility === undefined ? {} : { visibility: body.visibility }),
      ...(body.repoVisibility === undefined ? {} : { repoVisibility: body.repoVisibility }),
    });
    // The daemon row is the registration's other half: the operator sees which port and checkout now answer for it.
    return c.json(
      {
        ...gameResponse(game),
        daemon: {
          slug: game.slug,
          port: body.daemon.port,
          repo: `${body.repo.owner}/${body.repo.name}`,
          checkoutPath: body.daemon.checkoutPath,
        },
      },
      201,
    );
  })
  .post('/games/:id/delist', (c) => {
    const { db } = c.get('deps');
    const actor = admin(c, 'game.delist');
    const game = findGameForFamily(db, c.req.param('id'), actor.familyId);
    db.update(schema.games)
      .set({ delistedAt: game.delistedAt ?? new Date().toISOString() })
      .where(eq(schema.games.id, game.id))
      .run();
    return c.json(gameResponse(findGame(db, game.id)));
  })
  .post('/games/:id/relist', (c) => {
    const { db } = c.get('deps');
    const actor = admin(c, 'game.delist');
    const game = findGameForFamily(db, c.req.param('id'), actor.familyId);
    db.update(schema.games).set({ delistedAt: null }).where(eq(schema.games.id, game.id)).run();
    return c.json(gameResponse(findGame(db, game.id)));
  })
  .post('/games/:id/flag-abuse', async (c) => {
    const { db } = c.get('deps');
    const actor = admin(c, 'game.flag_abuse');
    const game = findGameForFamily(db, c.req.param('id'), actor.familyId);
    const { reason } = await parseBody(c, FlagGameAbuseBody);
    const flag = {
      id: `af_${randomUUID()}`,
      gameId: game.id,
      familyId: actor.familyId,
      flaggedBy: actor.userId,
      reason,
      createdAt: new Date().toISOString(),
    };
    db.insert(schema.gameAbuseFlags).values(flag).run();
    const response = {
      id: flag.id,
      gameId: flag.gameId,
      reason: flag.reason,
      createdAt: flag.createdAt,
    } satisfies GameAbuseFlag;
    return c.json({ flag: response }, 201);
  })
  .get('/builds', async (c) => {
    const actor = admin(c, 'admin.analytics.read');
    return c.json({ builds: await familyBuilds(c.get('deps'), actor.familyId) });
  })
  .get('/intake', (c) => {
    admin(c, 'admin.settings.set');
    return c.json(readIntake(c.get('deps').config.intakeDir));
  })
  .get('/mail', async (c) => {
    const actor = admin(c, 'admin.members.manage');
    const query = parseQuery(c, z.object({ unopened: flag }));
    const recipients = await familyRecipients(c.get('deps'), actor);
    if (recipients.length === 0) return c.json({ mail: [] });
    const toFamily = inArray(sql`lower(${schema.mailOutbox.to})`, recipients);
    const mail = c
      .get('deps')
      .db.select()
      .from(schema.mailOutbox)
      .where(query.unopened === '1' ? and(toFamily, isNull(schema.mailOutbox.openedAt)) : toFamily)
      .orderBy(desc(schema.mailOutbox.createdAt))
      .limit(50)
      .all();
    return c.json({
      mail: mail.map(({ id, to, subject, text, createdAt, openedAt }) => ({
        id,
        to,
        subject,
        text,
        createdAt,
        openedAt,
      })),
    });
  })
  .post('/mail/:id/opened', async (c) => {
    const actor = admin(c, 'admin.members.manage');
    const deps = c.get('deps');
    const row = deps.db
      .select({ to: schema.mailOutbox.to })
      .from(schema.mailOutbox)
      .where(eq(schema.mailOutbox.id, c.req.param('id')))
      .get();
    const recipients = await familyRecipients(deps, actor);
    if (!row || !recipients.includes(row.to.toLowerCase())) throw new HttpError(404, 'mail_not_found');
    markOpened(deps.sqlite, c.req.param('id'));
    return c.body(null, 204);
  });

export default routes;
