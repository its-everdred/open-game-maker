import { createCipheriv, createDecipheriv, createHash, createHmac, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { schema, type Db } from '@ogm/db';
import type { AppDeps } from '../app/types.js';

type Payload = {
  session: string;
  user: string;
  game: string;
  build: string;
  kind: 'owner' | 'player';
  userEpoch: string;
  gameEpoch: string;
  release?: string | null;
};
const keyName = (kind: 'user' | 'game', id: string) => `artifact-epoch:${kind}:${id}`;

export function artifactEpoch(db: Db, kind: 'user' | 'game', id: string): string {
  return (
    db
      .select()
      .from(schema.appMeta)
      .where(eq(schema.appMeta.key, keyName(kind, id)))
      .get()?.value ?? ''
  );
}

export function invalidateArtifactGrants(db: Db, kind: 'user' | 'game', id: string): void {
  const key = keyName(kind, id);
  db.insert(schema.appMeta)
    .values({ key, value: randomUUID() })
    .onConflictDoUpdate({ target: schema.appMeta.key, set: { value: randomUUID() } })
    .run();
}

function encryptionKey(deps: AppDeps): Buffer {
  return createHash('sha256').update('artifact-session-grant-v1:').update(deps.config.jobTokenSecret).digest();
}

export function issueSessionGrant(
  deps: AppDeps,
  session: string,
  user: string,
  game: string,
  build: string,
  kind: 'owner' | 'player',
): string {
  const release =
    kind === 'player'
      ? deps.db
          .select({ id: schema.games.publishedReleaseId })
          .from(schema.games)
          .where(eq(schema.games.id, game))
          .get()?.id
      : undefined;
  const payload: Payload = {
    session,
    user,
    game,
    build,
    kind,
    userEpoch: artifactEpoch(deps.db, 'user', user),
    gameEpoch: artifactEpoch(deps.db, 'game', game),
    ...(kind === 'player' ? { release } : {}),
  };
  const plaintext = JSON.stringify(payload);
  // The nonce is keyed by the complete payload, so identical session grants keep
  // one URL while a changed session or authorization epoch receives a new one.
  const nonceKey = createHash('sha256')
    .update('artifact-session-nonce-v1:')
    .update(deps.config.jobTokenSecret)
    .digest();
  const nonce = createHmac('sha256', nonceKey).update(plaintext).digest().subarray(0, 12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(deps), nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64url');
}

export function readSessionGrant(
  deps: AppDeps,
  token: string,
  game: string,
  build: string,
): { userId: string; headers: Headers; kind?: 'player' } | null {
  try {
    if (!/^[A-Za-z0-9_-]{44,2048}$/u.test(token)) return null;
    const raw = Buffer.from(token, 'base64url');
    if (raw.length < 29) return null;
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(deps), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const payload = JSON.parse(
      Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'),
    ) as Payload;
    if (
      payload.game !== game ||
      payload.build !== build ||
      !['owner', 'player'].includes(payload.kind) ||
      payload.userEpoch !== artifactEpoch(deps.db, 'user', payload.user) ||
      payload.gameEpoch !== artifactEpoch(deps.db, 'game', game)
    )
      return null;
    if (
      payload.kind === 'player' &&
      deps.db.select({ id: schema.games.publishedReleaseId }).from(schema.games).where(eq(schema.games.id, game)).get()
        ?.id !== payload.release
    )
      return null;
    const session = deps.db
      .select()
      .from(schema.session)
      .where(and(eq(schema.session.id, payload.session), eq(schema.session.userId, payload.user)))
      .get();
    if (!session || session.expiresAt.getTime() <= Date.now()) return null;
    return {
      userId: payload.user,
      headers: new Headers({ authorization: `Bearer ${session.token}` }),
      ...(payload.kind === 'player' ? { kind: 'player' as const } : {}),
    };
  } catch {
    return null;
  }
}
