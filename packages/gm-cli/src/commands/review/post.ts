import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { ReviewSubmission } from '@ogm/contracts';
import { CommandError, EXIT, UsageError, type GmCommand } from '../../command.js';
import { gameDir, workspaceRoot } from '../../outbox.js';

export const command: GmCommand = {
  name: 'review post',
  summary: 'post a review round from a JSON submission',
  usage: '<submission.json>',
  flags: {},
  async run(ctx, args) {
    if (args.length !== 1) throw new UsageError('provide a submission JSON file', 'gm help review post');
    let input: unknown;
    try {
      input = JSON.parse(readFileSync(args[0]!, 'utf8')) as unknown;
    } catch {
      throw new UsageError('cannot read submission JSON', 'gm help review post');
    }
    const parsed = ReviewSubmission.safeParse(input);
    if (!parsed.success) throw new CommandError(parsed.error.issues.map((issue) => issue.message).join('; '));
    if (!ctx.blobApi)
      throw new UsageError('no daemon upload configuration', 'set OGM_INTERNAL_URL and OGM_HOOK_SECRET_FILE');
    const root = workspaceRoot(ctx.cwd);
    const slug = basename(gameDir(ctx.cwd, root));
    const secret = readFileSync(ctx.blobApi.secretFile, 'utf8').trim();
    if (!secret) throw new CommandError('daemon hook secret is empty');
    const response = await fetch(
      `${ctx.blobApi.url.replace(/\/+$/, '')}/internal/games/${encodeURIComponent(slug)}/review-rounds`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
        body: JSON.stringify(parsed.data),
        signal: AbortSignal.timeout(20_000),
      },
    );
    const body = await response.text();
    if (!response.ok) throw new CommandError(`review post failed (HTTP ${response.status}): ${body}`);
    ctx.out(body);
    return EXIT.ok;
  },
};
