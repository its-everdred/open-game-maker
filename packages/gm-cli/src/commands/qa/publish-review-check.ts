import { CommandError, EXIT, UsageError, type GmCommand } from '../../command.js';
import { hostEnv, request } from '../publish/index.js';

export const command: GmCommand = {
  name: 'qa publish-review-check',
  summary: 'verify that a published build has a prototype review round',
  usage: '<game slug> <build id> [--api <url>]',
  example: 'qa publish-review-check dusk-helm build_01BX5ZZKBKACTAV9WEVGEMMVRZ',
  flags: {
    api: { type: 'string', help: 'API base URL (default http://127.0.0.1:$OGM_API_PORT from api.env)' },
    all: { type: 'boolean', default: false, help: 'check every published build awaiting its prototype review' },
  },
  async run(ctx, args, flags) {
    if (flags.all && args.length !== 0)
      throw new UsageError('--all takes no game arguments', 'gm qa publish-review-check --all');
    if (!flags.all && args.length !== 2)
      throw new UsageError('provide a game slug and build id', 'gm help qa publish-review-check');
    const [slug, buildId] = args;
    const env = hostEnv(ctx, ctx.home ?? '');
    const api = (typeof flags.api === 'string' ? flags.api : `http://127.0.0.1:${env.OGM_API_PORT}`).replace(
      /\/+$/u,
      '',
    );
    let apiUrl: URL;
    try {
      apiUrl = new URL(api);
    } catch {
      throw new UsageError('API URL must be a local HTTP endpoint', 'use http://127.0.0.1:<port>');
    }
    if (
      !['http:', 'https:'].includes(apiUrl.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(apiUrl.hostname)
    )
      throw new UsageError('API URL must be a local HTTP endpoint', 'use http://127.0.0.1:<port>');
    if (!env.OGM_INTERNAL_TOKEN || (typeof flags.api !== 'string' && !env.OGM_API_PORT))
      throw new UsageError('publish review check needs the internal token and API port', 'configure api.env');
    const url = flags.all
      ? `${api}/internal/operator/prototype-review-gaps`
      : `${api}/internal/operator/games/${encodeURIComponent(slug!)}/builds/${encodeURIComponent(buildId!)}/prototype-review`;
    const response = await request(url, {
      headers: { 'x-ogm-internal': env.OGM_INTERNAL_TOKEN, accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status !== 200)
      throw new CommandError(`review check failed (HTTP ${response.status}): ${response.body}`);
    if (flags.all) {
      const result = JSON.parse(response.body) as { gaps?: { slug: string; buildId: string }[] };
      const gaps = result.gaps ?? [];
      if (!gaps.length) {
        ctx.out('no published builds are waiting for prototype reviews');
        return EXIT.ok;
      }
      for (const gap of gaps) ctx.err(`prototype review missing for ${gap.slug} build ${gap.buildId}`);
      return EXIT.failed;
    }
    const result = JSON.parse(response.body) as { recorded?: boolean; roundId?: string };
    if (!result.recorded) {
      ctx.err(`published build ${buildId} has no prototype review round`);
      return EXIT.failed;
    }
    ctx.out(`prototype review ${result.roundId} recorded for ${buildId}`);
    return EXIT.ok;
  },
};
