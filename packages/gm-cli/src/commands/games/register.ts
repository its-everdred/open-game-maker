import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';

import { CommandError, EXIT, UsageError, type GmCommand } from '../../command.js';
import { printJson } from '../../context.js';
import { hostEnv, request } from '../publish/index.js';

export const command: GmCommand = {
  name: 'games register',
  summary: 'register a game already in an instance repository',
  usage:
    '<slug> --repo <owner/repo> --folder <games/slug> --title <title> [--owner <user-id>] [--visibility <listed|private>] [--checkout <path>] [--api <url>]',
  flags: {
    repo: { type: 'string', help: 'GitHub repository owner/name' },
    folder: { type: 'string', help: 'game folder in the repository' },
    title: { type: 'string', help: 'game title' },
    owner: { type: 'string', help: 'app user id (default the instance family owner)' },
    visibility: { type: 'string', help: 'listed or private' },
    checkout: { type: 'string', help: 'repository checkout (default ~/games/<repo>)' },
    api: { type: 'string', help: 'API base URL' },
  },
  async run(ctx, args, flags) {
    const repo = typeof flags.repo === 'string' ? /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(flags.repo) : null;
    if (args.length !== 1 || !repo || typeof flags.folder !== 'string' || typeof flags.title !== 'string')
      throw new UsageError('slug, repo, folder and title are required', 'gm help games register');
    if (flags.folder !== `games/${args[0]}`)
      throw new UsageError('folder must match the slug', 'use --folder games/<slug>');
    if (flags.visibility !== undefined && flags.visibility !== 'private' && flags.visibility !== 'listed')
      throw new UsageError('invalid visibility', 'use listed or private');
    const home = ctx.home ?? homedir();
    const checkout = resolve(
      ctx.cwd,
      typeof flags.checkout === 'string' ? flags.checkout : join(home, 'games', repo[2]!),
    );
    let port: unknown;
    try {
      const origin = execFileSync('git', ['-C', checkout, 'remote', 'get-url', 'origin'], { encoding: 'utf8' })
        .trim()
        .replace(/\.git$/, '');
      const remote = /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([^/]+)\/([^/]+)$/i.exec(
        origin,
      );
      if (
        !remote ||
        remote[1]!.toLowerCase() !== repo[1]!.toLowerCase() ||
        remote[2]!.toLowerCase() !== repo[2]!.toLowerCase()
      )
        throw new Error('origin does not match --repo');
      const config = parse(readFileSync(join(checkout, '.aiur', 'config'), 'utf8')) as { server?: { port?: unknown } };
      port = config.server?.port;
    } catch (error) {
      throw new UsageError(
        `cannot read the matching checkout's Aiur configuration: ${error instanceof Error ? error.message : String(error)}`,
        'pass --checkout <path>',
      );
    }
    if (!Number.isInteger(port) || (port as number) < 1 || (port as number) > 65535)
      throw new UsageError('Aiur configuration has no valid server port', 'set server.port in the checkout');
    const env = hostEnv(ctx, home);
    if (!env.OGM_INTERNAL_TOKEN) throw new UsageError('no internal token', 'set OGM_INTERNAL_TOKEN in api.env');
    const api = (
      typeof flags.api === 'string' ? flags.api : env.OGM_API_PORT ? `http://127.0.0.1:${env.OGM_API_PORT}` : ''
    ).replace(/\/+$/, '');
    if (!api) throw new UsageError('no API port', 'set OGM_API_PORT in api.env or pass --api');
    const response = await request(`${api}/internal/operator/games`, {
      method: 'POST',
      headers: { 'x-ogm-internal': env.OGM_INTERNAL_TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: args[0],
        title: flags.title,
        repo: { owner: repo[1], name: repo[2], path: flags.folder },
        daemon: { port, checkoutPath: checkout },
        ...(typeof flags.owner === 'string' ? { ownerId: flags.owner } : {}),
        ...(typeof flags.visibility === 'string' ? { visibility: flags.visibility } : {}),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status !== 200 && response.status !== 201)
      throw new CommandError(`registration failed (HTTP ${response.status}): ${response.body}`);
    let game: unknown;
    try {
      game = JSON.parse(response.body);
    } catch {
      throw new CommandError('registration returned invalid JSON');
    }
    if (game === null || typeof game !== 'object' || Array.isArray(game))
      throw new CommandError('registration returned invalid JSON');
    if (ctx.json) printJson(ctx, game);
    else ctx.out(`registered ${args[0]}`);
    return EXIT.ok;
  },
};
