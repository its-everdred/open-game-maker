import { and, asc, eq } from 'drizzle-orm';

import {
  SceneDocSchema,
  SceneRevisionSchema,
  type SceneAuthor,
  type SceneDoc,
  type SceneHead,
  type SceneRevision,
  type SceneSource,
} from '@ogm/contracts';
import { schema, type Db } from '@ogm/db';
import { commitScene, type CommitSceneResult } from '@ogm/design-log';

import { sceneSummary, type SceneSummary } from '../scenery/source.js';

/**
 * The shared scene store (#1209): #1207's head and revision log in the API's database, so the creator's map maker and
 * every agent's `gm scene pull`/`push` meet on one history. The rules are `commitScene`'s; this only persists them.
 */
export type SceneStore = { head: SceneHead; log: SceneRevision[] };
/** The database or a transaction on it. */
type Conn = Pick<Db, 'select' | 'insert'>;

export function readScene(db: Conn, gameId: string, scene: string): SceneStore | undefined {
  const head = db
    .select()
    .from(schema.sceneHeads)
    .where(and(eq(schema.sceneHeads.gameId, gameId), eq(schema.sceneHeads.scene, scene)))
    .get();
  if (!head) return undefined;
  const log = db
    .select({ revision: schema.sceneRevisions.revision })
    .from(schema.sceneRevisions)
    .where(and(eq(schema.sceneRevisions.gameId, gameId), eq(schema.sceneRevisions.scene, scene)))
    .orderBy(asc(schema.sceneRevisions.rev))
    .all()
    .map((row) => SceneRevisionSchema.parse(JSON.parse(row.revision)));
  return { head: { rev: head.rev, doc: SceneDocSchema.parse(JSON.parse(head.doc)) }, log };
}

export function listScenes(db: Db, gameId: string): SceneSummary[] {
  const heads = db
    .select({ scene: schema.sceneHeads.scene })
    .from(schema.sceneHeads)
    .where(eq(schema.sceneHeads.gameId, gameId))
    .orderBy(asc(schema.sceneHeads.scene))
    .all();
  return heads.flatMap(({ scene }) => {
    const log = readScene(db, gameId, scene)?.log ?? [];
    return log.length > 0 ? [sceneSummary(scene, log)] : [];
  });
}

/**
 * Start the shared store from a scene the repository already holds (its committed head and log), keeping its history
 * so agents' bases still resolve. A store that already exists wins: it is never overwritten by a file copy.
 */
export function seedScene(db: Db, gameId: string, files: SceneStore, now: Date): SceneStore {
  return db.transaction((tx) => {
    const existing = readScene(tx, gameId, files.head.doc.scene);
    if (existing) return existing;
    insertStore(tx, gameId, files, now);
    return files;
  });
}

function insertStore(db: Conn, gameId: string, store: SceneStore, now: Date): void {
  const scene = store.head.doc.scene;
  for (const revision of store.log) {
    db.insert(schema.sceneRevisions)
      .values({ gameId, scene, rev: revision.rev, revision: JSON.stringify(revision) })
      .run();
  }
  db.insert(schema.sceneHeads)
    .values({ gameId, scene, rev: store.head.rev, doc: JSON.stringify(store.head.doc), updatedAt: now.toISOString() })
    .run();
}

export type SceneWrite = {
  doc: SceneDoc;
  baseRev: number;
  author: SceneAuthor;
  source: SceneSource;
  label: string;
  now: Date;
};

/**
 * Commit one writer's document on the current head. A scene nobody has saved yet starts empty at revision 0, as
 * `gm scene pull --pack` starts one. `commitScene` may throw `InvalidSceneError` or `SceneBaseUnavailableError`.
 */
export function writeScene(db: Db, gameId: string, write: SceneWrite): CommitSceneResult {
  return db.transaction((tx) => {
    const store = readScene(tx, gameId, write.doc.scene);
    const head: SceneHead = store?.head ?? {
      rev: 0,
      doc: { ...write.doc, layers: {}, objects: {}, hd2d: {} },
    };
    const result = commitScene({ head, log: store?.log ?? [], ...write });
    if (!result.ok || !result.revision) return result;
    tx.insert(schema.sceneRevisions)
      .values({
        gameId,
        scene: write.doc.scene,
        rev: result.revision.rev,
        revision: JSON.stringify(result.revision),
      })
      .run();
    const doc = JSON.stringify(result.head.doc);
    const updatedAt = write.now.toISOString();
    tx.insert(schema.sceneHeads)
      .values({ gameId, scene: write.doc.scene, rev: result.head.rev, doc, updatedAt })
      .onConflictDoUpdate({
        target: [schema.sceneHeads.gameId, schema.sceneHeads.scene],
        set: { rev: result.head.rev, doc, updatedAt },
      })
      .run();
    return result;
  });
}

/** A creator's display name as a scene author slug (`Kevin` → `kevin`); `creator` when it has no usable letters. */
export function creatorAuthor(displayName: string): SceneAuthor {
  const slug = displayName
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/, '');
  return slug.length > 0 ? slug : 'creator';
}
