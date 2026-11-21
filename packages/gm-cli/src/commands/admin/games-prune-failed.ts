import { join } from 'node:path';

import { readEnvFile } from '../publish/index.js';
import { EXIT, UsageError, type GmCommand } from '../../command.js';

export const command: GmCommand = {
  name: 'admin games prune-failed',
  summary: 'list or remove games with a failed create audit and no repository or release',
  usage: '[--dry-run | --prune] [--api <url>]',
  example: 'gm admin games prune-failed --dry-run',
  flags: {
    'dry-run': { type: 'boolean', default: false, help: 'list eligible rows without removing them (default)' },
    prune: { type: 'boolean', default: false, help: 'remove each eligible row after confirming its failed audit' },
    api: { type: 'string', help: 'loopback API origin (default from OGM_API_PORT in api.env)' },
  },
  async run(ctx, args, flags) {
    if (args.length) throw new UsageError('unexpected argument', 'gm admin games prune-failed --dry-run');
    if (flags['dry-run'] === true && flags.prune === true)
      throw new UsageError('choose either --dry-run or --prune', 'gm admin games prune-failed --dry-run');
    const apiEnv = readEnvFile(join(ctx.env?.OGM_ENV_DIR || join(ctx.home!, '.config', 'ogm', 'env'), 'api.env'));
    const token = ctx.env?.OGM_INTERNAL_TOKEN || apiEnv.OGM_INTERNAL_TOKEN;
    const api =
      (flags.api as string | undefined) ?? (apiEnv.OGM_API_PORT ? `http://127.0.0.1:${apiEnv.OGM_API_PORT}` : '');
    if (!token || !api)
      throw new UsageError(
        'API operator configuration is missing',
        'set OGM_INTERNAL_TOKEN and OGM_API_PORT in api.env',
      );
    let origin: URL;
    try {
      origin = new URL(api);
    } catch {
      throw new UsageError('API origin must be a loopback HTTP origin', 'use --api http://127.0.0.1:<port>');
    }
    if (
      origin.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) ||
      origin.username !== '' ||
      origin.password !== '' ||
      origin.pathname !== '/' ||
      origin.search !== '' ||
      origin.hash !== ''
    )
      throw new UsageError('API origin must be a loopback HTTP origin', 'use --api http://127.0.0.1:<port>');
    const headers = { 'x-ogm-internal': token, 'x-ogm-service': 'commit' };
    const listed = await fetch(`${api.replace(/\/+$/u, '')}/api/v1/internal/admin/games/prune-failed-candidates`, {
      headers,
    });
    if (!listed.ok) throw new Error(`failed-create candidate lookup returned HTTP ${listed.status}`);
    const body = (await listed.json()) as { games?: { id: string; title: string; createdAt: string }[] };
    if (!Array.isArray(body.games)) throw new Error('failed-create candidate lookup returned invalid JSON');
    for (const game of body.games) {
      if (flags.prune !== true) {
        if (!ctx.json) ctx.out(`${game.id}\t${game.title}\t${game.createdAt}`);
      } else {
        const removed = await fetch(
          `${api.replace(/\/+$/u, '')}/api/v1/internal/admin/games/${encodeURIComponent(game.id)}/prune-failed`,
          { method: 'DELETE', headers },
        );
        if (!removed.ok) throw new Error(`${game.id}: prune returned HTTP ${removed.status}`);
        const result = (await removed.json()) as { removed?: unknown };
        if (typeof result.removed !== 'boolean') throw new Error(`${game.id}: prune returned invalid JSON`);
        if (!ctx.json) ctx.out(`${game.id}\t${result.removed ? 'removed' : 'skipped'}`);
      }
    }
    if (ctx.json) ctx.out(JSON.stringify({ dryRun: flags.prune !== true, games: body.games }));
    else if (body.games.length === 0) ctx.out('no failed creates matched');
    return EXIT.ok;
  },
};
