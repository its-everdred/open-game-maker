import { access, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CommandError, EXIT, UsageError, type GmCommand } from '../../command.js';
import { runChild } from '../capture/shell.js';

const screenNames = [
  'all',
  'Title',
  'Home',
  'Editor',
  'Settings',
  'SignIn',
  'NewGame',
  'GameSheet',
  'Admin',
  'Activity',
];
export const command: GmCommand = {
  name: 'design parity',
  summary: 'compare seeded app screens against the approved glass artboards',
  usage:
    '[--screen Title|Home|Editor|Settings|SignIn|NewGame|GameSheet|Admin|Activity|all] [--web apps/web] [--dist <real-game-dist>] [--timeout seconds]',
  flags: {
    screen: { type: 'string', default: 'all', help: 'screen to compare, or all' },
    web: { type: 'string', default: 'apps/web', help: 'path to the web application' },
    dist: { type: 'string', help: 'real game build for editor captures' },
    timeout: { type: 'number', default: 900, help: 'total timeout in seconds' },
    port: { type: 'number', default: 43175, help: 'strict local preview port' },
    'bridge-port': { type: 'number', default: 43176, help: 'local game fixture port' },
  },
  async run(ctx, args, flags) {
    const screen = flags.screen;
    const timeout = flags.timeout;
    const port = flags.port;
    const bridge = flags['bridge-port'];
    if (args.length || typeof screen !== 'string' || !screenNames.includes(screen) || typeof flags.web !== 'string')
      throw new UsageError('invalid screen or web directory', 'gm help design parity');
    if (
      typeof timeout !== 'number' ||
      !Number.isFinite(timeout) ||
      timeout <= 0 ||
      typeof port !== 'number' ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535 ||
      typeof bridge !== 'number' ||
      !Number.isInteger(bridge) ||
      bridge < 1 ||
      bridge > 65535 ||
      bridge === port
    )
      throw new UsageError('invalid timeout or ports', 'gm help design parity');
    if ((screen === 'Editor' || screen === 'all') && typeof flags.dist !== 'string')
      throw new UsageError('editor parity requires a real game build', 'pass --dist <game dist>');
    let dist: string | undefined;
    if (typeof flags.dist === 'string') {
      dist = await realpath(resolve(ctx.cwd, flags.dist)).catch(() => {
        throw new UsageError('real game build is unavailable', 'pass --dist <game dist>');
      });
      if (dist.split(/[\\/]/).includes('fixtures'))
        throw new UsageError('test fixture games are not valid parity evidence', 'pass --dist <real game dist>');
      await Promise.all(
        ['index.html', 'manifest.json', 'design/design.json'].map((file) => access(resolve(dist!, file))),
      ).catch(() => {
        throw new UsageError('real game build is incomplete', 'pass --dist <game dist>');
      });
    }
    const web = resolve(ctx.cwd, flags.web);
    await access(resolve(web, 'e2e/glass-parity.spec.ts')).catch(() => {
      throw new CommandError('web parity tests are unavailable in the selected directory');
    });
    const env = {
      ...ctx.env,
      OGM_GLASS_PARITY_SCREEN: screen,
      OGM_WEB_E2E_PORT: String(port),
      OGM_WEB_BRIDGE_PORT: String(bridge),
      ...(dist ? { OGM_GLASS_GAME_DIST: dist } : {}),
    };
    const deadline = Date.now() + timeout * 1000;
    const signal = new AbortController().signal;
    const build = await runChild(web, ['run', 'prepare:browser'], env, timeout * 1000, signal);
    if (build !== EXIT.ok) return build;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return EXIT.timeout;
    const result = await runChild(
      web,
      ['exec', 'playwright', 'test', 'e2e/glass-parity.spec.ts', '--project', 'desktop', '--workers=1'],
      env,
      remaining,
      signal,
    );
    return result;
  },
};
