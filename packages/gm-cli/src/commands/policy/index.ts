import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { EXIT, UsageError, type GmCommand, type GmContext } from '../../command.js';

type Source = 'live' | 'bundle' | 'default';

// The instance setting through the daemon's internal route, then as of the job's start in `.gm/context/bundle.json`.
async function live(ctx: GmContext): Promise<boolean | null> {
  if (!ctx.blobApi) return null;
  try {
    const secret = (await readFile(ctx.blobApi.secretFile, 'utf8')).trim();
    const response = await fetch(new URL('/internal/gameplay', ctx.blobApi.url), {
      headers: { authorization: `Bearer ${secret}` },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { paidApisDuringGameplay?: unknown };
    return typeof body.paidApisDuringGameplay === 'boolean' ? body.paidApisDuringGameplay : null;
  } catch {
    return null;
  }
}

async function bundled(cwd: string): Promise<boolean | null> {
  try {
    const bundle = JSON.parse(await readFile(join(cwd, '.gm/context/bundle.json'), 'utf8')) as {
      gameContext?: { paidApisDuringGameplay?: unknown };
    };
    const value = bundle.gameContext?.paidApisDuringGameplay;
    return typeof value === 'boolean' ? value : null;
  } catch {
    return null;
  }
}

export const command: GmCommand = {
  name: 'policy',
  summary: 'whether a played game may call paid APIs (instance admin setting; off unless known to be on)',
  flags: {},
  async run(ctx, args) {
    if (args.length > 0) throw new UsageError('gm policy takes no arguments', 'gm policy --json');
    let source: Source = 'live';
    let allowed = await live(ctx);
    if (allowed === null) {
      source = 'bundle';
      allowed = await bundled(ctx.cwd);
    }
    if (allowed === null) {
      source = 'default';
      allowed = false;
    }
    if (ctx.json) ctx.out(JSON.stringify({ paidApisDuringGameplay: allowed, source }));
    else ctx.out(`paid APIs during gameplay: ${allowed ? 'on' : 'off'} (${source})`);
    return EXIT.ok;
  },
};
