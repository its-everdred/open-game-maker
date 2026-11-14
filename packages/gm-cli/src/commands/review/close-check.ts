import { homedir } from 'node:os';
import { CommandError, EXIT, UsageError, type GmCommand } from '../../command.js';
import { hostEnv } from '../publish/index.js';

// Host merge tools must fail closed when the API cannot establish track ownership.
export const command: GmCommand = {
  name: 'review close-check',
  summary: 'check whether a review ticket may close',
  usage: '<game> <ticket> <sha>',
  flags: {},
  async run(ctx, args) {
    if (
      args.length !== 3 ||
      !/^[a-z0-9][a-z0-9-]*$/u.test(args[0]!) ||
      !/^[1-9][0-9]*$/u.test(args[1]!) ||
      !/^[a-f0-9]{40}$/u.test(args[2]!)
    )
      throw new UsageError('provide a game slug, ticket number, and commit SHA', 'gm help review close-check');
    const env = hostEnv(ctx, ctx.home ?? homedir());
    if (!env.OGM_INTERNAL_TOKEN || !env.OGM_API_PORT) throw new CommandError('API operator configuration is missing');
    const [slug, ticket, sha] = args as [string, string, string];
    const response = await fetch(
      `http://127.0.0.1:${env.OGM_API_PORT}/internal/operator/games/${encodeURIComponent(slug)}/review-close/${ticket}?sha=${sha}`,
      {
        headers: { 'x-ogm-internal': env.OGM_INTERNAL_TOKEN },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok) throw new CommandError(`review close check failed (HTTP ${response.status})`);
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || !('allowed' in body) || typeof body.allowed !== 'boolean')
      throw new CommandError('review close check returned an invalid response');
    ctx.out(body.allowed ? 'allowed' : 'blocked');
    return body.allowed ? EXIT.ok : EXIT.failed;
  },
};
