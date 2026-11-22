import { SCENE_SCHEMA_VERSION, SceneDocSchema, type SceneDoc } from '@ogm/contracts';

import { InvalidSceneError } from './scene.js';

/** `from` version → a step producing version `from + 1`. Each step must keep every tile, object and setting. */
export type SceneMigrations = Readonly<Record<number, (doc: Record<string, unknown>) => Record<string, unknown>>>;

/** Version 1 is the first scene document; later versions add their step here. */
export const SCENE_MIGRATIONS: SceneMigrations = {};

/** Bring a stored scene up to the current schema version; `from` is the version it was stored at. */
export function migrateScene(
  raw: unknown,
  migrations: SceneMigrations = SCENE_MIGRATIONS,
): { doc: SceneDoc; from: number } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw new InvalidSceneError('scene is not an object');
  let doc = raw as Record<string, unknown>;
  const from = doc.schemaVersion;
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 0) {
    throw new InvalidSceneError('scene has no schemaVersion');
  }
  if (from > SCENE_SCHEMA_VERSION) {
    throw new InvalidSceneError(`scene schemaVersion ${from} is newer than ${SCENE_SCHEMA_VERSION}; update gm`);
  }
  for (let version = from; version < SCENE_SCHEMA_VERSION; version += 1) {
    const step = migrations[version];
    if (step === undefined) throw new InvalidSceneError(`no migration from scene schemaVersion ${version}`);
    doc = { ...step(doc), schemaVersion: version + 1 };
  }
  const parsed = SceneDocSchema.safeParse(doc);
  if (!parsed.success) {
    throw new InvalidSceneError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || 'scene'}: ${issue.message}`).join('; '),
    );
  }
  return { doc: parsed.data, from };
}
