import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { CommandError, EXIT, UsageError, type GmCommand } from '../../command.js';
import { resolveContainedPath } from '../../context.js';

export async function runChild(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeout: number,
  signal: AbortSignal,
): Promise<number> {
  return new Promise((resolveCode, reject) => {
    const child = spawn('pnpm', args, { cwd, env, stdio: 'inherit', detached: true });
    let timedOut = false;
    const stop = () => {
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* already exited */
        }
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeout);
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    child.once('error', (error) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
      resolveCode(signal.aborted ? 130 : timedOut ? EXIT.timeout : (code ?? EXIT.failed));
    });
  });
}

export const command: GmCommand = {
  name: 'capture shell',
  summary: 'capture touch stills in a local app shell with mocked sign-in',
  usage: '--web <apps/web> --dist <game dist> --out <directory> [--tap <text>...] [--timeout <seconds>]',
  flags: {
    web: { type: 'string', help: 'path to the core apps/web directory' },
    dist: { type: 'string', help: 'path to the built game directory' },
    out: { type: 'string', help: 'output directory for stills' },
    tap: { type: 'string', multiple: true, help: 'exact text to tap in sequence' },
    timeout: { type: 'number', default: 600, help: 'total timeout in seconds' },
    port: { type: 'number', default: 43178, help: 'local shell preview port' },
  },
  async run(ctx, args, flags) {
    if (args.length || typeof flags.web !== 'string' || typeof flags.dist !== 'string' || typeof flags.out !== 'string')
      throw new UsageError('web, dist and out paths are required', 'gm help capture shell');
    const timeout = flags.timeout as number;
    const port = flags.port as number;
    if (timeout <= 0 || port < 1 || port > 65535)
      throw new UsageError('invalid timeout or port', 'gm help capture shell');
    const web = resolve(ctx.cwd, flags.web);
    const dist = resolve(ctx.cwd, flags.dist);
    for (const name of ['index.html', 'design/design.json']) {
      const file = await resolveContainedPath(dist, resolve(dist, name)).catch(() => null);
      if (
        !file ||
        !(await stat(file)
          .then((entry) => entry.isFile())
          .catch(() => false))
      )
        throw new UsageError(`game build is missing ${name}`, 'build the game before gm capture shell');
    }
    const temp = mkdtempSync(resolve(tmpdir(), 'gm-shell-'));
    const env = {
      ...ctx.env,
      VITE_GAMES_ORIGIN: 'http://127.0.0.1:10000',
      GM_SHELL_DIST: dist,
      GM_SHELL_OUT: resolve(temp, 'shots'),
      GM_SHELL_WEB_DIST: temp,
      GM_SHELL_PORT: String(port),
      GM_SHELL_TAPS: JSON.stringify(flags.tap ?? []),
    };
    const deadline = Date.now() + timeout * 1000;
    const abort = new AbortController();
    const stop = () => abort.abort();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    const { acquireSlot } = await import('@ogm/gm-verify');
    let slot: Awaited<ReturnType<typeof acquireSlot>> | undefined;
    try {
      for (const commandArgs of [
        ['run', 'build:deps'],
        ['exec', 'vite', 'build', '--outDir', temp, '--emptyOutDir'],
      ]) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) return EXIT.timeout;
        const result = await runChild(web, commandArgs, env, remaining, abort.signal);
        if (result !== 0) return result;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) return EXIT.timeout;
      slot = await acquireSlot({
        runtimeDir: ctx.config.runtimeDir,
        waitMs: Math.min(remaining, 600_000),
        signal: abort.signal,
      });
      const captureTime = deadline - Date.now();
      if (captureTime <= 0) return EXIT.timeout;
      const result = await runChild(
        web,
        ['exec', 'playwright', 'test', '--config', 'e2e/shell-capture.config.ts', '--max-failures=1'],
        env,
        captureTime,
        abort.signal,
      );
      if (result !== 0) return result;
      const sizes = ['390x844', '844x390', '820x1180', '1180x820'];
      for (const size of sizes)
        if (!existsSync(resolve(env.GM_SHELL_OUT, `play-${size}.png`)))
          throw new CommandError(`shell capture did not produce play-${size}.png`);
      const out = resolve(ctx.cwd, flags.out);
      mkdirSync(out, { recursive: true });
      const publish = mkdtempSync(resolve(out, '.gm-shell-publish-'));
      try {
        for (const size of sizes) {
          for (const prefix of ['play', 'ingame', 'menu']) {
            const name = `${prefix}-${size}.png`;
            const source = resolve(env.GM_SHELL_OUT, name);
            if (existsSync(source)) {
              const staged = resolve(publish, name);
              copyFileSync(source, staged);
              renameSync(staged, resolve(out, name));
            } else rmSync(resolve(out, name), { force: true });
          }
        }
      } finally {
        rmSync(publish, { recursive: true, force: true });
      }
      ctx.out('App-shell captures complete (mocked sign-in; not production or Safari).');
      return EXIT.ok;
    } catch (error) {
      if (abort.signal.aborted) return 130;
      if (Date.now() >= deadline) return EXIT.timeout;
      throw new CommandError(`shell capture failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      slot?.release();
      rmSync(temp, { recursive: true, force: true });
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
    }
  },
};
