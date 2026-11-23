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
import { commitScene, isAgent, type CommitSceneResult } from '@ogm/design-log';

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

export type SceneListing = { id: string; rev: number; author: string; updatedAt: string };

export function listScenes(db: Db, gameId: string): SceneListing[] {
  const heads = db
    .select({ scene: schema.sceneHeads.scene, rev: schema.sceneHeads.rev })
    .from(schema.sceneHeads)
    .where(eq(schema.sceneHeads.gameId, gameId))
    .orderBy(asc(schema.sceneHeads.scene))
    .all();
  return heads.flatMap(({ scene, rev }) => {
    const row = db
      .select({ revision: schema.sceneRevisions.revision })
      .from(schema.sceneRevisions)
      .where(
        and(
          eq(schema.sceneRevisions.gameId, gameId),
          eq(schema.sceneRevisions.scene, scene),
          eq(schema.sceneRevisions.rev, rev),
        ),
      )
      .get();
    if (!row) return [];
    const last = SceneRevisionSchema.parse(JSON.parse(row.revision));
    return [{ id: scene, rev, author: last.author, updatedAt: last.createdAt }];
  });
}

/**
 * Why a head and log may not start a game's shared scene, or undefined when they may: it must be this game's scene, and
 * its log revisions 1..rev in order. `agentOnly` is for history an agent sends: only the API records a creator's
 * revision, so a sent log naming one is refused rather than trusted to lock units against every other agent.
 */
export function seedRefusal(
  store: SceneStore,
  ids: { game: string; scene: string },
  options: { agentOnly?: boolean } = {},
): string | undefined {
  if (store.head.doc.game !== ids.game || store.head.doc.scene !== ids.scene) return 'it is another game or scene';
  if (store.log.length !== store.head.rev || store.log.some((revision, index) => revision.rev !== index + 1)) {
    return `its log is not revisions 1..${store.head.rev} in order`;
  }
  if (options.agentOnly && store.log.some((revision) => !isAgent(revision.author))) {
    return "it holds a creator's revision";
  }
  return undefined;
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
