import { homedir } from 'node:os';

import { daemonPaths, unitName } from '@ogm/builder';
import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { RegisterGameBody } from '../admin/shapes.js';
import { HttpError } from '../app/errors.js';
import type { AppDeps } from '../app/types.js';
import { findGame } from '../games/games.js';
import { registeredSlug, registerExistingGame } from '../games/register.js';
import { findGameBySlugOrId } from '../games/slug.js';

export const OperatorRegisterBody = RegisterGameBody.extend({ slug: z.string().min(1).max(48) }).strict();

type Input = z.infer<typeof OperatorRegisterBody>;

export function registerOperatorGame(deps: AppDeps, body: Input) {
  const { db } = deps;
  if (registeredSlug(body.repo.path) !== body.slug) throw new HttpError(422, 'game_slug_mismatch');
  const existing = findGameBySlugOrId(db, body.slug);
  if (
    existing &&
    (existing.slug !== body.slug ||
      existing.githubOwner?.toLowerCase() !== body.repo.owner.toLowerCase() ||
      existing.githubRepo?.toLowerCase() !== body.repo.name.toLowerCase() ||
      existing.githubPath !== body.repo.path)
  ) {
    throw new HttpError(409, 'game_slug_taken');
  }
  const ownerId = body.ownerId ?? deps.config.instanceOwnerId;
  const families = ownerId
    ? db.select().from(schema.familyMembers).where(eq(schema.familyMembers.userId, ownerId)).all()
    : db.select().from(schema.familyMembers).where(eq(schema.familyMembers.role, 'owner')).all();
  if (families.length !== 1) throw new HttpError(409, 'owner_ambiguous');
  const member = families[0]!;
  if (existing && existing.familyId !== member.familyId) throw new HttpError(409, 'game_family_mismatch');
  const instance = body.repo.name.toLowerCase();
  const daemon = {
    ...body.daemon,
    unit: body.daemon.unit ?? unitName(instance),
    envFile: body.daemon.envFile ?? daemonPaths(homedir(), instance).envFile,
  };
  if (existing) {
    const rows = db
      .select()
      .from(schema.gameDaemons)
      .where(eq(schema.gameDaemons.repo, `${body.repo.owner}/${body.repo.name}`.toLowerCase()))
      .all();
    if (rows.length !== 1) throw new HttpError(409, 'repo_daemon_ambiguous');
    const current = rows[0]!;
    const portOwner = db.select().from(schema.gameDaemons).where(eq(schema.gameDaemons.port, daemon.port)).get();
    if (portOwner && portOwner.slug !== current.slug) throw new HttpError(409, 'daemon_port_taken');
    db.transaction((tx) => {
      tx.update(schema.gameDaemons)
        .set({ port: daemon.port, checkoutPath: daemon.checkoutPath, unit: daemon.unit, envFile: daemon.envFile })
        .where(eq(schema.gameDaemons.slug, current.slug))
        .run();
      tx.update(schema.games)
        .set({
          title: body.title,
          ownerId: member.userId,
          ...(body.visibility === undefined ? {} : { visibility: body.visibility }),
          ...(body.repoVisibility === undefined ? {} : { repoVisibility: body.repoVisibility }),
        })
        .where(eq(schema.games.id, existing.id))
        .run();
    });
    return { game: findGame(db, existing.id), created: false };
  }
  return {
    game: registerExistingGame(db, {
      familyId: member.familyId,
      ownerId: member.userId,
      title: body.title,
      repo: body.repo,
      daemon,
      ...(body.visibility === undefined ? {} : { visibility: body.visibility }),
      ...(body.repoVisibility === undefined ? {} : { repoVisibility: body.repoVisibility }),
      shareRepoDaemon: true,
    }),
    created: true,
  };
}
