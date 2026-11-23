import { existsSync } from 'node:fs';
import { appendFile, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  SceneIdSchema,
  SceneRevisionSchema,
  type SceneAuthor,
  type SceneDoc,
  type SceneHd2dSection,
  type SceneHead,
  type SceneRevision,
} from '@ogm/contracts';
import { emptyScene, migrateScene, sha256Canonical } from '@ogm/design-log';
import {
  LightingPresetSchema,
  focusConfigSchema,
  occlusionStyleSchema,
  particleEffectSchema,
  sceneAtmosphereSchema,
} from '@gm/sdk/hd2d/schemas';
import { z } from 'zod';

import { CommandError, UsageError } from '../command.js';
import { workspaceRoot } from '../outbox.js';

export type SceneStore = { head: SceneHead; log: SceneRevision[]; exists: boolean };
export type SceneRef = { root: string; gameDir: string; game: string; scene: string };

const hd2dSchemas = {
  lighting: LightingPresetSchema,
  focus: focusConfigSchema,
  atmosphere: sceneAtmosphereSchema,
  occlusion: occlusionStyleSchema,
  particles: z.record(z.string(), particleEffectSchema),
} satisfies Record<SceneHd2dSection, z.ZodType>;

/** `games/<game>/` in a monorepo, or the root of a one-game repository. */
export function sceneRef(cwd: string, game: string, scene: string): SceneRef {
  for (const [name, value] of [
    ['game', game],
    ['scene', scene],
  ] as const) {
    if (!SceneIdSchema.safeParse(value).success) {
      throw new UsageError(`${name} must be a lowercase slug`, 'gm scene pull dusk-helm graveyard');
    }
  }
  const root = workspaceRoot(cwd);
  const nested = join(root, 'games', game);
  if (existsSync(join(nested, 'gm.manifest.json'))) return { root, gameDir: nested, game, scene };
  if (existsSync(join(root, 'gm.manifest.json'))) return { root, gameDir: root, game, scene };
  throw new CommandError(`no game ${game}: expected games/${game}/gm.manifest.json or a one-game repository`);
}

function paths(ref: SceneRef): { head: string; log: string; lock: string } {
  const base = join(ref.gameDir, 'scenes', ref.scene);
  return { head: `${base}.scene.json`, log: `${base}.revs.jsonl`, lock: `${base}.lock` };
}

export function workingCopyPath(ref: SceneRef): string {
  return join(ref.root, '.gm', 'scenes', ref.game, `${ref.scene}.json`);
}

/** HD-2D settings must load in the runtime, so check them with the runtime's own schemas. */
export function validateHd2d(doc: SceneDoc): void {
  const problems: string[] = [];
  for (const [section, entry] of Object.entries(doc.hd2d)) {
    const result = hd2dSchemas[section as SceneHd2dSection].safeParse(entry.settings);
    if (!result.success) {
      problems.push(...result.error.issues.map((issue) => `hd2d.${section}.${issue.path.join('.')}: ${issue.message}`));
    }
  }
  if (problems.length > 0) throw new CommandError(`invalid HD-2D settings: ${problems.join('; ')}`);
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new CommandError(`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Read the head and log; a scene that does not exist yet is an empty document at revision 0. */
export async function readStore(ref: SceneRef, packAdapter?: string): Promise<SceneStore & { from: number }> {
  const file = paths(ref);
  if (!existsSync(file.head)) {
    // A log with no head is a first write that stopped before its commit point: nothing in it was committed.
    await rm(file.log, { force: true });
    if (packAdapter === undefined) {
      throw new CommandError(`no scene ${ref.game}/${ref.scene} yet; pass --pack <adapter> to start one`);
    }
    return { head: { rev: 0, doc: emptyScene(ref.game, ref.scene, packAdapter) }, log: [], exists: false, from: 1 };
  }
  const raw = await readJson(file.head);
  const record = (typeof raw === 'object' && raw !== null ? raw : {}) as { rev?: unknown; doc?: unknown };
  if (typeof record.rev !== 'number' || !Number.isInteger(record.rev) || record.rev < 0) {
    throw new CommandError(`${file.head} has no revision`);
  }
  let migrated: ReturnType<typeof migrateScene>;
  try {
    migrated = migrateScene(record.doc);
  } catch (error) {
    throw new CommandError(`${file.head}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (migrated.doc.game !== ref.game || migrated.doc.scene !== ref.scene) {
    throw new CommandError(`${file.head} holds ${migrated.doc.game}/${migrated.doc.scene}`);
  }
  const log: SceneRevision[] = [];
  const lines = existsSync(file.log)
    ? (await readFile(file.log, 'utf8')).split('\n').filter((line) => line.trim())
    : [];
  // The head is the commit point: lines logged after its revision were never committed (a write stopped between the
  // two, possibly mid-line), so only the first `rev` lines are read.
  const rev = record.rev;
  for (const [index, line] of lines.slice(0, rev).entries()) {
    let parsed;
    try {
      parsed = SceneRevisionSchema.safeParse(JSON.parse(line));
    } catch {
      parsed = undefined;
    }
    if (!parsed?.success) throw new CommandError(`${file.log}:${index + 1} is not a scene revision`);
    log.push(parsed.data);
  }
  if (log.some((revision, index) => revision.rev !== index + 1) || log.length !== rev) {
    throw new CommandError(`${file.log} does not hold revisions 1..${rev} in order`);
  }
  if (lines.length > rev) {
    const temp = `${file.log}.${process.pid}.tmp`;
    await writeFile(temp, log.map((revision) => `${JSON.stringify(revision)}\n`).join(''));
    await rename(temp, file.log);
  }
  return { head: { rev, doc: migrated.doc }, log, exists: true, from: migrated.from };
}

/** Hold the scene's lock file while `work` runs, so two writers cannot interleave. */
export async function withSceneLock<T>(ref: SceneRef, work: () => Promise<T>): Promise<T> {
  const { lock } = paths(ref);
  await mkdir(dirname(lock), { recursive: true });
  let handle;
  try {
    handle = await open(lock, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new CommandError(`another write holds ${lock}; retry, or remove it if no gm scene is running`);
    }
    throw error;
  }
  try {
    await handle.close();
    return await work();
  } finally {
    await rm(lock, { force: true });
  }
}

/** Append the revision, then replace the head; the log is written first so a crash never leaves a head without history. */
export async function writeRevision(ref: SceneRef, head: SceneHead, revision: SceneRevision): Promise<void> {
  const file = paths(ref);
  await mkdir(dirname(file.head), { recursive: true });
  await appendFile(file.log, `${JSON.stringify(revision)}\n`);
  const temp = `${file.head}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(head, null, 2)}\n`);
  await rename(temp, file.head);
}

/** Persist an upgrade read from an older schema as a `migration` revision, so later bases start after it. */
export async function persistMigration(
  ref: SceneRef,
  store: SceneStore & { from: number },
  author: SceneAuthor,
  now: Date,
): Promise<SceneStore> {
  if (!store.exists || store.from === store.head.doc.schemaVersion) return store;
  const revision: SceneRevision = {
    rev: store.head.rev + 1,
    parentRev: store.head.rev,
    baseRev: store.head.rev,
    author,
    source: 'migration',
    label: `migrate scene schema ${store.from} to ${store.head.doc.schemaVersion}`,
    createdAt: now.toISOString(),
    changes: [],
    docHash: sha256Canonical(store.head.doc),
  };
  const head = { rev: revision.rev, doc: store.head.doc };
  await writeRevision(ref, head, revision);
  return { head, log: [...store.log, revision], exists: true };
}

/**
 * Mirror the shared store (#1209) into the game folder: the whole log, then the head, each replaced atomically, so the
 * build and the agent's commit carry exactly what the API holds.
 */
export async function writeStore(
  ref: SceneRef,
  store: { head: SceneHead; log: readonly SceneRevision[] },
): Promise<void> {
  const file = paths(ref);
  await mkdir(dirname(file.head), { recursive: true });
  const log = `${file.log}.${process.pid}.tmp`;
  await writeFile(log, store.log.map((revision) => `${JSON.stringify(revision)}\n`).join(''));
  await rename(log, file.log);
  const head = `${file.head}.${process.pid}.tmp`;
  await writeFile(head, `${JSON.stringify(store.head, null, 2)}\n`);
  await rename(head, file.head);
}
