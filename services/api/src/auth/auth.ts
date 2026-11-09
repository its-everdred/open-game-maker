import { randomUUID } from 'node:crypto';

import { passkey } from '@better-auth/passkey';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { bearer, magicLink } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';

import { schema, type Db } from '@ogm/db';

import { normalizeEmail } from './access.js';
import type { AuthEnv } from './env.js';
import type { MailSender } from './mail.js';
import { clientIp, createRateLimiter } from './rate-limit.js';

export const MAGIC_LINK_TTL_SEC = 15 * 60;
export const MAGIC_LINK_RESPONSE = {
  status: true,
  message: 'If this address can sign in, a link is on its way',
} as const;
type AuthLogLevel = 'debug' | 'info' | 'warn' | 'error';

export function createAuthLogger(log: (line: Record<string, unknown>) => void) {
  return {
    log: (level: AuthLogLevel, ...unsafe: unknown[]) => {
      void unsafe;
      log({ event: 'better-auth', level });
    },
  };
}

const PASSKEY_SIGN_IN_PATHS = new Set([
  '/passkey/generate-authenticate-options',
  '/passkey/verify-authentication',
  '/passkey/authenticate',
]);

const signInNotAllowed = () =>
  new APIError('FORBIDDEN', { message: 'sign in is not allowed', code: 'SIGN_IN_NOT_ALLOWED' });

// The two surfaces the API uses; the full inferred type drags in WebAuthn types this package cannot name.
export interface Auth {
  handler(request: Request): Promise<Response>;
  api: {
    getSession(input: {
      headers: Headers;
    }): Promise<{ user: { id: string; name: string; email: string }; session: { id: string } } | null>;
  };
}

export function createAuth(deps: {
  db: Db;
  env: AuthEnv;
  mail: MailSender;
  // Read at call time: an address added or removed in the app changes the next request, not the next boot.
  isAllowed: (email: string) => boolean;
  log: (line: Record<string, unknown>) => void;
}): Auth {
  const { db, env, mail, isAllowed, log } = deps;
  const appOrigin = new URL(env.OGM_APP_ORIGIN).origin;
  const magicLinkPerIp = createRateLimiter(10);
  const magicLinkPerEmail = createRateLimiter(10);
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
      : {};

  return betterAuth({
    appName: 'Open Game Maker 2000',
    baseURL: appOrigin,
    basePath: '/auth',
    secret: env.OGM_SESSION_SECRET,
    trustedOrigins: [appOrigin],
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        passkey: schema.passkey,
      },
    }),
    emailAndPassword: { enabled: false },
    session: { expiresIn: 7 * 24 * 60 * 60, updateAge: 24 * 60 * 60 },
    socialProviders: google,
    plugins: [
      magicLink({
        expiresIn: MAGIC_LINK_TTL_SEC,
        sendMagicLink: async ({ email, url, token }) => {
          try {
            await mail.send({
              to: email,
              subject: 'Your Open Game Maker 2000 sign-in link',
              text: `Open this link to sign in (it works once, for 15 minutes):\n\n${url}\n`,
            });
          } catch {
            db.delete(schema.verification)
              .where(eq(schema.verification.identifier, `magic-link:${token}`))
              .run();
            log({ event: 'auth-magic-link-mail-failed', level: 'error' });
            return;
          }
        },
      }),
      passkey({ rpID: new URL(appOrigin).hostname, rpName: 'Open Game Maker 2000', origin: appOrigin }),
      bearer(),
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === '/sign-in/magic-link') {
          const email = normalizeEmail(String((ctx.body as { email?: unknown } | undefined)?.email ?? ''));
          if (!magicLinkPerIp(clientIp(ctx.headers ?? new Headers())) || !magicLinkPerEmail(email)) {
            throw new APIError('TOO_MANY_REQUESTS', { message: 'too many sign-in links', code: 'RATE_LIMITED' });
          }
          if (!isAllowed(email)) return ctx.json(MAGIC_LINK_RESPONSE);
        }
        // Signing in with a passkey has no session yet: only registration and passkey management need one.
        // The session-create hook below still refuses a passkey sign-in for an address off the allow-list.
        if (ctx.path.startsWith('/passkey/') && !PASSKEY_SIGN_IN_PATHS.has(ctx.path)) {
          const session = await getSessionFromCtx(ctx, { disableCookieCache: true, disableRefresh: true });
          if (!session || !isAllowed(session.user.email)) throw signInNotAllowed();
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path === '/sign-in/magic-link' && !(ctx.context.returned instanceof APIError)) {
          return ctx.json(MAGIC_LINK_RESPONSE);
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (!isAllowed(user.email)) throw signInNotAllowed();
            return { data: user };
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const user = db
              .select({ email: schema.user.email })
              .from(schema.user)
              .where(eq(schema.user.id, session.userId))
              .get();
            if (!user || !isAllowed(user.email)) throw signInNotAllowed();
          },
        },
      },
    },
    advanced: {
      database: { generateId: ({ model }) => (model === 'user' ? `u_${randomUUID()}` : randomUUID()) },
    },
    telemetry: { enabled: false },
    // Better Auth interpolates request values into messages, so only retain the stable severity.
    logger: createAuthLogger(log),
  });
}
