import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { CommandError, EXIT, UsageError, type GmCommand } from '../../command.js';
import { printJson } from '../../context.js';
import { readLock } from '../../lock.js';
import { gameDir, workspaceRoot } from '../../outbox.js';
import { scanReferences, unlisted } from '../../references.js';

export const command: GmCommand = {
  name: 'preview',
  summary: 'build the current workspace for creator review without publishing',
  usage: '[--ticket <number>] [--branch <id>]',
  flags: {
    ticket: { type: 'string', help: 'ticket receiving the verdict (defaults to the current agent ticket)' },
    branch: { type: 'string', help: 'game branch receiving the preview (defaults to main)' },
  },
  async run(ctx, args, flags) {
    if (args.length) throw new UsageError('gm preview takes no positional arguments', 'gm help preview');
    const root = workspaceRoot(ctx.cwd);
    const branch = spawnSync('git', ['-C', root, 'branch', '--show-current'], { encoding: 'utf8' }).stdout.trim();
    const branchTicket = /^aiur\/(\d+)(?:-|$)/u.exec(branch)?.[1];
    const ticket = typeof flags.ticket === 'string' ? flags.ticket : String(ctx.config.aiurIssue ?? branchTicket ?? '');
    if (!/^[1-9]\d{0,15}$/u.test(ticket)) throw new UsageError('no valid ticket', 'gm preview --ticket <number>');
    const branchId = typeof flags.branch === 'string' ? flags.branch : 'main';
    if (!/^[A-Za-z0-9_-]{1,200}$/u.test(branchId))
      throw new UsageError('invalid game branch', 'gm preview --branch <id>');
    const previewFile = join(root, '.gm', 'context', 'preview.json');
    const scoped = existsSync(previewFile)
      ? (JSON.parse(readFileSync(previewFile, 'utf8')) as { token?: string })
      : null;
    const workerUpload = scoped?.token ? { token: scoped.token } : null;
    if (!workerUpload && !ctx.blobApi)
      throw new UsageError('no daemon upload configuration', 'run inside a configured worker workspace');
    let game = gameDir(ctx.cwd, root);
    const isGame = (dir: string) =>
      existsSync(join(dir, 'package.json')) &&
      (existsSync(join(dir, 'gm.manifest.json')) || existsSync(join(dir, 'manifest.json')));
    if (game === root && ctx.cwd !== root) {
      let candidate = ctx.cwd;
      while (candidate !== root && candidate.startsWith(`${root}/`)) {
        if (isGame(candidate)) {
          game = candidate;
          break;
        }
        candidate = dirname(candidate);
      }
    }
    const games = join(root, 'games');
    if (game === root && !isGame(game) && existsSync(games)) {
      const candidates = readdirSync(games, { withFileTypes: true }).filter(
        (entry) => entry.isDirectory() && isGame(join(games, entry.name)),
      );
      if (candidates.length === 1) game = join(games, candidates[0]!.name);
    }
    if (!isGame(game)) throw new UsageError('not inside a game folder', 'run gm preview from the game folder');
    const slug = basename(game);
    const git = spawnSync('git', ['-C', root, 'rev-parse', '--verify', 'HEAD'], { encoding: 'utf8' });
    const sha = git.stdout.trim();
    if (git.status !== 0 || !/^[0-9a-f]{40}$/u.test(sha)) throw new CommandError('cannot resolve workspace HEAD');
    const missingAssets = unlisted(
      (await readLock(game))?.assets.map((entry) => entry.id) ?? [],
      await scanReferences(game),
    );
    if (missingAssets.length)
      throw new CommandError(
        `assets.lock.json does not list assets the code uses:\n${missingAssets.map(({ id, file }) => `${id} (${file})`).join('\n')}\nTry: gm assets use <id>`,
      );
    const pkg = JSON.parse(readFileSync(join(game, 'package.json'), 'utf8')) as { scripts?: { build?: string } };
    const script = pkg.scripts?.build ?? '';
    if (!script) throw new CommandError('the game has no build script');
    const extra = [
      ...(script.includes('--base') ? [] : ['--base=./']),
      ...(script.includes('--mode') ? [] : ['--mode=published']),
    ];
    const childEnv: Record<string, string | undefined> = { ...ctx.env, NODE_ENV: 'production' };
    delete childEnv.OGM_INTERNAL_TOKEN;
    delete childEnv.OGM_HOOK_SECRET_FILE;
    const build = spawnSync('pnpm', ['run', 'build', ...(extra.length ? ['--', ...extra] : [])], {
      cwd: game,
      env: childEnv,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (build.status !== 0)
      throw new CommandError(
        `the game's build failed:\n${(build.stderr || build.stdout || build.error?.message || '').split('\n').slice(-20).join('\n')}`,
      );
    const dist = join(game, 'dist');
    const required = ['index.html', 'manifest.json', 'design/design.json', 'credits.json'];
    const missing = required.filter((file) => !existsSync(join(dist, file)));
    if (missing.length)
      throw new CommandError(`the build wrote no ${missing.map((file) => `dist/${file}`).join(', ')}`);
    if (readFileSync(join(dist, 'index.html'), 'utf8').includes('="/assets/'))
      throw new CommandError('dist/index.html loads assets from the origin root; set a relative base');
    const scratchRoot = join(root, '.gm', 'tmp');
    mkdirSync(scratchRoot, { recursive: true });
    const scratch = mkdtempSync(join(scratchRoot, 'preview-'));
    try {
      const stage = join(scratch, 'stage');
      cpSync(dist, stage, { recursive: true, verbatimSymlinks: true });
      for (const file of ['manifest.json', 'achievements.json']) {
        if (!existsSync(join(game, file))) continue;
        mkdirSync(dirname(join(stage, file)), { recursive: true });
        cpSync(join(game, file), join(stage, file));
      }
      const archive = join(scratch, 'build.tgz');
      const tar = spawnSync('tar', ['--format=ustar', '-czf', archive, '-C', stage, '.'], { encoding: 'utf8' });
      if (tar.status !== 0)
        throw new CommandError(`cannot archive the build: ${tar.stderr || tar.error?.message || ''}`);
      let preview: { buildId: string; gameId: string };
      if (workerUpload) {
        const directory = join(root, '.gm', 'preview');
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        const id = randomUUID();
        const requestFile = join(directory, `${id}.json`);
        const archiveFile = join(directory, `${id}.tgz`);
        const responseFile = join(directory, `${id}.response`);
        try {
          writeFileSync(archiveFile, readFileSync(archive), { mode: 0o600, flag: 'wx' });
          writeFileSync(
            `${requestFile}.tmp`,
            JSON.stringify({ state: 'pending', token: workerUpload.token, ticket, slug, sha, branch: branchId }),
            { mode: 0o600, flag: 'wx' },
          );
          renameSync(`${requestFile}.tmp`, requestFile);
          const deadline = Date.now() + 300_000;
          let result: { state: string; gameId?: string; buildId?: string; error?: string } | undefined;
          while (Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            try {
              result = JSON.parse(readFileSync(responseFile, 'utf8')) as typeof result;
            } catch {
              continue;
            }
            if (result?.state === 'failed') throw new CommandError(result.error || 'preview upload failed');
            if (result?.state === 'done' && result.gameId && result.buildId) break;
          }
          if (result?.state !== 'done' || !result.gameId || !result.buildId)
            throw new CommandError('preview upload timed out waiting for the host relay');
          preview = { gameId: result.gameId, buildId: result.buildId };
        } finally {
          rmSync(`${requestFile}.tmp`, { force: true });
          rmSync(requestFile, { force: true });
          rmSync(responseFile, { force: true });
          rmSync(archiveFile, { force: true });
        }
      } else {
        const secret = readFileSync(ctx.blobApi!.secretFile, 'utf8').trim();
        if (!secret) throw new CommandError('daemon hook secret is empty');
        const url = `${ctx.blobApi!.url.replace(/\/+$/, '')}/internal/games/${encodeURIComponent(slug)}/previews/${ticket}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${secret}`,
            'x-gm-sha': sha,
            'x-gm-branch': branchId,
            'content-type': 'application/gzip',
          },
          body: readFileSync(archive),
          signal: AbortSignal.timeout(300_000),
        });
        const body = await response.text();
        if (response.status !== 201) throw new CommandError(`preview upload failed (HTTP ${response.status}): ${body}`);
        preview = JSON.parse(body) as { buildId: string; gameId: string };
      }
      if (ctx.json) printJson(ctx, { state: 'done', ticket, sha, gameId: preview.gameId, buildId: preview.buildId });
      else ctx.out(`preview ready for ticket ${ticket}: ${preview.buildId}`);
      return EXIT.ok;
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  },
};
