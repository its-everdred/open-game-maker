import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { creditsDocumentSchema, DesignDocSchema, gameManifestSchema } from '@ogm/contracts';
import { buildDir, markComplete } from '@ogm/games-host/layout';

import type { AppDeps } from '../app/types.js';
import { withArtifactMutation } from '../builds/artifact-lock.js';
import { completeBuildCache } from '../builds/cache-plan.js';
import { BadArchive, untarGz } from '../builds/untar.js';
import { scanBuild } from '../gameplay/paid-integrations.js';
import { paidApisDuringGameplay } from '../gameplay/policy.js';

export type Preview = {
  gameId: string;
  ticket: string;
  buildId: string;
  sha: string;
  createdAt: string;
  answered: boolean;
};

const ticketPattern = /^[1-9]\d{0,15}$/u;
const previewPattern = /^preview-[0-9a-f-]{36}$/u;
const root = (deps: AppDeps, gameId: string) => join(deps.config.gamesRoot, '.previews', gameId);

function checkKey(deps: AppDeps, gameId: string, ticket: string) {
  buildDir(deps.config.gamesRoot, gameId, 'preview-check');
  if (!ticketPattern.test(ticket)) throw new BadArchive('invalid_ticket');
}

async function readPreview(file: string): Promise<Preview | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as Preview;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function writePreview(file: string, value: Preview): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value), { flag: 'wx' });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function json(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

/** An upload becomes visible only after its complete immutable build is on disk. */
export async function createPreview(deps: AppDeps, gameId: string, ticket: string, sha: string, archive: Buffer) {
  checkKey(deps, gameId, ticket);
  return withArtifactMutation(async () => {
    const buildId = `preview-${randomUUID()}`;
    const directory = root(deps, gameId);
    const temporary = join(directory, `.${buildId}`);
    const target = buildDir(deps.config.gamesRoot, gameId, buildId);
    let installed = false;
    try {
      await mkdir(temporary, { recursive: true });
      await untarGz(archive, temporary);
      const index = await readFile(join(temporary, 'index.html'), 'utf8').catch(() => null);
      if (index === null || index.includes('="/assets/')) throw new BadArchive('index_invalid');
      const manifest = gameManifestSchema.safeParse(await json(join(temporary, 'manifest.json')));
      if (!manifest.success) throw new BadArchive('manifest_invalid');
      if (!DesignDocSchema.safeParse(await json(join(temporary, 'design', 'design.json'))).success)
        throw new BadArchive('design_invalid');
      if (!creditsDocumentSchema.safeParse(await json(join(temporary, 'credits.json'))).success)
        throw new BadArchive('credits_invalid');
      const integrations = await scanBuild(temporary);
      if (integrations.credentials.length) throw new BadArchive('provider_credential');
      if (integrations.paid.length && !paidApisDuringGameplay(deps.db)) throw new BadArchive('paid_integration');
      await completeBuildCache({
        root: deps.config.gamesRoot,
        files: temporary,
        gameId,
        buildId,
        previousBuildId: null,
        sdkVersion: manifest.data.sdk,
      });
      await mkdir(join(deps.config.gamesRoot, gameId), { recursive: true });
      await rename(temporary, target);
      installed = true;
      await markComplete(target);
      const preview: Preview = { gameId, ticket, buildId, sha, createdAt: new Date().toISOString(), answered: false };
      await writePreview(join(directory, `${ticket}.json`), preview);
      return preview;
    } catch (error) {
      if (installed) await rm(target, { recursive: true, force: true });
      throw error;
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
}

export async function listPreviews(deps: AppDeps, gameId: string): Promise<Preview[]> {
  checkKey(deps, gameId, '1');
  const directory = root(deps, gameId);
  const names = await readdir(directory).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  });
  const previews = await Promise.all(
    names.filter((name) => /^[1-9]\d{0,15}\.json$/u.test(name)).map((name) => readPreview(join(directory, name))),
  );
  return previews
    .filter((preview): preview is Preview => preview !== null && !preview.answered)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Deliver first; only the precise version answered is removed from the queue. */
export async function answerPreview(
  deps: AppDeps,
  gameId: string,
  ticket: string,
  buildId: string,
  message: string,
): Promise<boolean> {
  checkKey(deps, gameId, ticket);
  return withArtifactMutation(async () => {
    const file = join(root(deps, gameId), `${ticket}.json`);
    const preview = await readPreview(file);
    if (!preview || preview.answered || preview.buildId !== buildId) return false;
    const client = await deps.aiurClientForGame(gameId);
    const receipt = await client.message(ticket, message, `preview:${buildId}`, AbortSignal.timeout(20_000));
    if (receipt.warning === 'outcome_unknown') throw new Error('preview_delivery_unknown');
    await writePreview(file, { ...preview, answered: true });
    return true;
  });
}

/** Preview builds are immutable and may still be open in a browser after a newer upload. */
export async function previewBuildDirectories(deps: AppDeps): Promise<string[]> {
  const games = await readdir(join(deps.config.gamesRoot, '.previews')).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  });
  const directories = await Promise.all(
    games.map(async (gameId) => {
      const builds = await readdir(join(deps.config.gamesRoot, gameId)).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      });
      return builds.filter((id) => previewPattern.test(id)).map((id) => buildDir(deps.config.gamesRoot, gameId, id));
    }),
  );
  return directories.flat();
}
