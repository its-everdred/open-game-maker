import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
} from 'node:fs';
import { join } from 'node:path';
import { DesignDocSchema } from '@ogm/contracts';

/** Build into a private directory, then switch the live pointer after it succeeds. */
export async function buildLiveSnapshot(game: string, env: NodeJS.ProcessEnv): Promise<string> {
  const live = join(game, '.gm', 'live');
  const versions = join(live, 'versions');
  mkdirSync(versions, { recursive: true });
  const child = spawn('flock', ['-n', join(live, 'build.lock'), 'sh', '-c', 'printf locked; cat >/dev/null'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const done = new Promise<void>((resolve) => {
    child.once('close', () => resolve());
    child.once('error', () => resolve());
  });
  const locked = await new Promise<boolean>((resolve) => {
    child.stdout.once('data', () => resolve(true));
    child.once('close', () => resolve(false));
    child.once('error', () => resolve(false));
  });
  if (!locked) throw new Error('a live build is already running or its lock could not be acquired');
  const id = randomUUID();
  const target = join(versions, id);
  const pointer = join(live, `.current-${id}`);
  try {
    const previous = (() => {
      try {
        return readlinkSync(join(live, 'current'));
      } catch {
        return '';
      }
    })();
    for (const entry of readdirSync(versions, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/u.test(entry.name) || previous === `versions/${entry.name}`)
        continue;
      const path = join(versions, entry.name);
      if (statSync(path).mtimeMs < Date.now() - 60 * 60 * 1000) rmSync(path, { recursive: true, force: true });
    }
    const childEnv: NodeJS.ProcessEnv = { ...env, NODE_ENV: 'production' };
    delete childEnv.OGM_INTERNAL_TOKEN;
    delete childEnv.OGM_HOOK_SECRET_FILE;
    const pkg = JSON.parse(readFileSync(join(game, 'package.json'), 'utf8')) as { scripts?: { build?: string } };
    const script = pkg.scripts?.build ?? '';
    if (!script) throw new Error('the game has no build script');
    if (script.includes('--outDir')) throw new Error('the build script must allow the live output directory');
    const extra = [
      '--outDir',
      target,
      ...(script.includes('--base') ? [] : ['--base=./']),
      ...(script.includes('--mode') ? [] : ['--mode=published']),
    ];
    const result = spawnSync('pnpm', ['run', 'build', ...extra], { cwd: game, env: childEnv, encoding: 'utf8' });
    if (result.status !== 0)
      throw new Error(`build failed: ${result.stderr || result.stdout || result.error?.message || ''}`);
    if (!existsSync(join(target, 'index.html'))) throw new Error('build did not write its live output directory');
    rejectLinks(target);
    if (readFileSync(join(target, 'index.html'), 'utf8').includes('="/assets/'))
      throw new Error('live build loads assets from the origin root; set a relative base');
    try {
      const design = join(target, 'design', 'design.json');
      if (statSync(design).size > 4 * 1024 * 1024) throw new Error('design too large');
      DesignDocSchema.parse(JSON.parse(readFileSync(design, 'utf8')) as unknown);
    } catch {
      throw new Error('live build has a missing or invalid design');
    }
    symlinkSync(join('versions', id), pointer);
    renameSync(pointer, join(live, 'current'));
    if (/^versions\/[0-9a-f-]{36}$/u.test(previous)) {
      try {
        utimesSync(join(live, previous), new Date(), new Date());
      } catch {
        /* old build may have disappeared */
      }
    }
    return target;
  } catch (error) {
    rmSync(target, { recursive: true, force: true });
    throw error;
  } finally {
    rmSync(pointer, { force: true });
    child.stdin.end();
    await done;
  }
}

function rejectLinks(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('live builds cannot contain symbolic links');
    if (entry.isDirectory()) rejectLinks(join(directory, entry.name));
    else if (!entry.isFile()) throw new Error('live builds may contain only regular files');
    else if (statSync(join(directory, entry.name)).nlink !== 1)
      throw new Error('live builds cannot contain hard links');
  }
}
