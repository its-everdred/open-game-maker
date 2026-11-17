import { createHmac } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { schema, type Db } from '@ogm/db';

import { HttpError } from '../app/errors.js';
import { createFamily } from '../accounts/families.js';
import { normalizeEmail } from '../auth/access.js';
import type { Auth } from '../auth/auth.js';
import { createGameRow } from '../games/games.js';
import { readQaState, writeQaState, type QaState } from './state.js';

// The QA account is created here and nowhere else, so it can never be a person's account: an address that already
// signs in (or a maintainer's) is refused, and only one QA account exists. It is a maker in a family of its own and
// owns one private game, so its session reaches that game and nothing of anyone else's.
export async function ensureQaAccount(
  db: Db,
  auth: Auth,
  input: { email: string; maintainers: ReadonlySet<string> },
): Promise<QaState> {
  const email = normalizeEmail(input.email);
  const existing = readQaState(db);
  if (existing) {
    if (existing.email !== email) throw new HttpError(409, 'qa_account_exists');
    const game = db
      .select({ id: schema.games.id })
      .from(schema.games)
      .where(eq(schema.games.id, existing.gameId))
      .get();
    if (!game) throw new HttpError(409, 'qa_game_missing');
    return existing;
  }
  if (input.maintainers.has(email)) throw new HttpError(409, 'qa_email_in_use');
  const taken =
    db
      .select({ email: schema.allowedUsers.email })
      .from(schema.allowedUsers)
      .where(eq(schema.allowedUsers.email, email))
      .get() ?? db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, email)).get();
  if (taken) throw new HttpError(409, 'qa_email_in_use');

  db.insert(schema.allowedUsers)
    .values({ email, role: 'maker', addedBy: 'qa', addedAt: new Date().toISOString() })
    .run();
  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.createUser({ email, name: 'QA', emailVerified: true }, { method: 'admin' });
  const family = createFamily(db, { userId: user.id, name: 'QA' });
  const game = createGameRow(db, {
    familyId: family.id,
    ownerId: user.id,
    title: 'QA Review',
    repoVisibility: 'private',
  });
  const state: QaState = {
    userId: user.id,
    email,
    familyId: family.id,
    gameId: game.id,
    decisions: [],
    received: [],
  };
  writeQaState(db, state);
  return state;
}

// A Better Auth session for the QA user and its cookie, signed the way Better Auth signs it, so a headless browser can
// carry it as storage state. The token itself is the secret: callers store it and never print it.
export async function mintQaSession(auth: Auth, userId: string) {
  const ctx = await auth.$context;
  const session = await ctx.internalAdapter.createSession(userId);
  if (!session) throw new HttpError(500, 'qa_session_failed');
  const signature = createHmac('sha256', ctx.secret).update(session.token).digest('base64');
  return {
    cookie: {
      name: ctx.authCookies.sessionToken.name,
      value: encodeURIComponent(`${session.token}.${signature}`),
    },
    expiresAt: new Date(session.expiresAt).toISOString(),
  };
}
