import { randomUUID } from 'node:crypto';
import { access as fileAccess, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
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
  branchId: string;
  buildId: string;
  sha: string;
  createdAt: string;
  answered: boolean;
  accessId: string;
  accessExpiresAt: string;
  pendingMessage?: string;
};

const ticketPattern = /^[1-9]\d{0,15}$/u;
const root = (deps: AppDeps, gameId: string) => join(deps.config.gamesRoot, '.previews', gameId);
const ACCESS_TTL = 60 * 60 * 1000;

function access() {
  return { accessId: `pv-${randomUUID()}`, accessExpiresAt: new Date(Date.now() + ACCESS_TTL).toISOString() };
}

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
export async function createPreview(
  deps: AppDeps,
  gameId: string,
  ticket: string,
  sha: string,
  archive: Buffer,
  branchId = 'main',
) {
  checkKey(deps, gameId, ticket);
  return withArtifactMutation(async () => {
    const buildId = `preview-${randomUUID()}`;
    const directory = root(deps, gameId);
    const temporary = join(directory, `.${buildId}`);
    const target = join(directory, '.builds', buildId);
    const previous = await readPreview(join(directory, `${ticket}.json`));
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
        privateAssets: true,
      });
      await mkdir(join(directory, '.builds'), { recursive: true });
      await rename(temporary, target);
      installed = true;
      await markComplete(target);
      const preview: Preview = {
        gameId,
        ticket,
        branchId,
        buildId,
        sha,
        createdAt: new Date().toISOString(),
        answered: false,
        ...access(),
      };
      await writePreview(join(directory, `${ticket}.json`), preview);
      if (previous && /^preview-[0-9a-f-]{36}$/u.test(previous.buildId)) {
        await rm(join(directory, '.builds', previous.buildId), { recursive: true, force: true }).catch(() => undefined);
      }
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
  return withArtifactMutation(() => listPreviewsUnlocked(deps, gameId, false));
}

export async function listEditorPreviews(deps: AppDeps, gameId: string): Promise<Preview[]> {
  checkKey(deps, gameId, '1');
  return withArtifactMutation(() => listPreviewsUnlocked(deps, gameId, true));
}

async function listPreviewsUnlocked(deps: AppDeps, gameId: string, includeAnswered: boolean): Promise<Preview[]> {
  const directory = root(deps, gameId);
  const names = await readdir(directory).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  });
  const previews = await Promise.all(
    names.filter((name) => /^[1-9]\d{0,15}\.json$/u.test(name)).map((name) => readPreview(join(directory, name))),
  );
  const open = previews
    .filter((preview): preview is Preview => preview !== null && (includeAnswered || !preview.answered))
    .map((preview) => ({ ...preview, branchId: preview.branchId ?? 'main' }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const available = await Promise.all(
    open.map(async (preview) => {
      if (!preview.answered) return preview;
      try {
        await fileAccess(join(previewDirectory(deps, gameId, preview.buildId), 'index.html'));
        return preview;
      } catch {
        return null;
      }
    }),
  );
  return Promise.all(
    available
      .filter((preview): preview is Preview => preview !== null)
      .map(async (preview) => {
        if (Date.parse(preview.accessExpiresAt) > Date.now() + 5 * 60_000) return preview;
        const refreshed = { ...preview, ...access() };
        await writePreview(join(directory, `${preview.ticket}.json`), refreshed);
        return refreshed;
      }),
  );
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
    if (preview.pendingMessage !== undefined && preview.pendingMessage !== message) return false;
    if (preview.pendingMessage === undefined) await writePreview(file, { ...preview, pendingMessage: message });
    const client = await deps.aiurClientForGame(gameId);
    const receipt = await client.message(ticket, message, `preview:${buildId}`, AbortSignal.timeout(20_000));
    if (receipt.warning === 'outcome_unknown') throw new Error('preview_delivery_unknown');
    await writePreview(file, { ...preview, ...access(), pendingMessage: message, answered: true });
    return true;
  });
}

export function previewDirectory(deps: AppDeps, gameId: string, buildId: string): string {
  checkKey(deps, gameId, '1');
  if (!/^preview-[0-9a-f-]{36}$/u.test(buildId)) throw new Error('invalid preview build id');
  return join(root(deps, gameId), '.builds', buildId);
}
