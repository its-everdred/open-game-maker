import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { DesignDocSchema } from '@ogm/contracts';
import { liveGeneration, openLiveFile } from '@ogm/games-host/live-files';

import type { AppDeps } from '../app/types.js';
import { HttpError } from '../app/errors.js';
import type { GameRow } from '../games/games.js';
import { paidApisDuringGameplay } from '../gameplay/policy.js';
import { liveManifest } from './live-manifest.js';

/** Create a short-lived games-origin capability only for an active, ticket-scoped workspace grant. */
export async function issueLiveAccess(deps: AppDeps, game: GameRow, ticket: string, home = homedir()) {
  if (
    !/^[1-9]\d{0,15}$/u.test(ticket) ||
    !game.slug ||
    !game.githubOwner ||
    !game.githubRepo ||
    !game.githubPath ||
    !deps.registry.trackerTicket
  )
    throw new HttpError(404, 'live_preview_not_found');
  const repo = `${game.githubOwner}/${game.githubRepo}`.toLowerCase();
  const issue = await deps.registry
    .trackerTicket({ owner: game.githubOwner, name: game.githubRepo }, ticket)
    .catch(() => null);
  const gameLabels = issue?.labels.filter((label) => label.startsWith('game:')) ?? [];
  if (!issue || issue.closedAt || gameLabels.length !== 1 || gameLabels[0] !== `game:${game.slug}`)
    throw new HttpError(404, 'live_preview_not_found');
  const hash = createHash('sha256').update(repo).digest('hex');
  const repoRoot = join(home, '.config/ogm/preview-repos', hash);
  const secret = await readFile(join(repoRoot, 'secret'), 'utf8').catch(() => '');
  if (!secret.trim()) throw new HttpError(404, 'live_preview_not_found');
  const grants = join(repoRoot, 'grants');
  const entries = await readdir(grants).catch(() => [] as string[]);
  const matches: { root: string; grantPath: string; grantId: string; grantHash: string }[] = [];
  for (const entry of entries) {
    if (!/^[0-9a-f]{64}\.json$/u.test(entry)) continue;
    const row = await readFile(join(grants, entry), 'utf8')
      .then(
        (text) =>
          JSON.parse(text) as {
            repo?: unknown;
            ticket?: unknown;
            game?: unknown;
            workspace?: unknown;
            grant?: unknown;
          },
      )
      .catch(() => null);
    if (
      !row ||
      row.repo !== repo ||
      row.ticket !== ticket ||
      row.game !== game.slug ||
      typeof row.grant !== 'string' ||
      !/^[0-9a-f-]{36}$/u.test(row.grant) ||
      typeof row.workspace !== 'string' ||
      !isAbsolute(row.workspace) ||
      `${createHash('sha256').update(row.workspace).digest('hex')}.json` !== entry
    )
      continue;
    if ((await realpath(row.workspace).catch(() => '')) !== row.workspace) continue;
    const gameDirectory = resolve(row.workspace, game.githubPath);
    if (!gameDirectory.startsWith(row.workspace + sep)) continue;
    const live = join(gameDirectory, '.gm', 'live');
    if ((await realpath(live).catch(() => '')) === live)
      matches.push({
        root: live,
        grantPath: join(grants, entry),
        grantId: row.grant,
        grantHash: createHash('sha256').update(JSON.stringify(row)).digest('hex'),
      });
  }
  if (matches.length !== 1) throw new HttpError(404, 'live_preview_not_found');
  const match = matches[0]!;
  const live = match.root;
  const version = await liveGeneration(live);
  if (!version) throw new HttpError(404, 'live_preview_not_found');
  let manifest: Record<string, string>;
  try {
    manifest = await liveManifest(live, version, paidApisDuringGameplay(deps.db));
    if (!manifest['index.html'] || !manifest['design/design.json']) throw new Error('incomplete live build');
    if (Buffer.byteLength(JSON.stringify(manifest)) > 20 * 1024 * 1024) throw new Error('live manifest too large');
  } catch {
    throw new HttpError(422, 'live_preview_refused');
  }
  const file = version && (await openLiveFile(live, 'design/design.json', version));
  if (!file || !version) throw new HttpError(404, 'live_preview_not_found');
  let doc;
  try {
    const size = (await file.stat()).size;
    if (size > 4 * 1024 * 1024) throw new Error('design too large');
    const buffer = Buffer.alloc(size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const result = await file.read(buffer, offset, buffer.length - offset, offset);
      if (!result.bytesRead) break;
      offset += result.bytesRead;
    }
    if (offset !== size) throw new Error('design changed');
    const contents = buffer.subarray(0, size);
    if (createHash('sha256').update(contents).digest('hex') !== manifest['design/design.json'])
      throw new Error('design changed');
    doc = DesignDocSchema.parse(JSON.parse(contents.toString('utf8')) as unknown);
  } catch {
    throw new HttpError(404, 'live_preview_not_found');
  } finally {
    await file.close();
  }
  const accessId = `lv-${randomUUID()}`;
  const directory = join(deps.config.gamesRoot, '.live', game.id);
  const target = join(directory, `${accessId}.json`);
  const temporary = `${target}.tmp`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  for (const entry of await readdir(directory)) {
    if (!/^lv-[0-9a-f-]{36}\.json$/u.test(entry)) continue;
    const path = join(directory, entry);
    const old = await readFile(path, 'utf8')
      .then((text) => JSON.parse(text) as { expiresAt?: string })
      .catch(() => null);
    if (typeof old?.expiresAt === 'string' && Date.parse(old.expiresAt) <= Date.now()) await rm(path, { force: true });
  }
  try {
    await writeFile(
      temporary,
      JSON.stringify({
        gameId: game.id,
        accessId,
        root: live,
        version,
        grantPath: match.grantPath,
        grantId: match.grantId,
        grantHash: match.grantHash,
        secretHash: createHash('sha256').update(secret).digest('hex'),
        manifest,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
      { mode: 0o600, flag: 'wx' },
    );
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
  return { accessId, version, design: { rev: 0, doc } };
}
