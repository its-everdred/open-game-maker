import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { AgentOutboxLine, ChatPostPayload, Id, type AgentOutboxLine as AgentOutboxLineValue } from '@ogm/contracts';

import { CommandError, UsageError } from './command.js';

const MAX_LINE_BYTES = 64 * 1024;
const MAX_CLIP_BYTES = 25 * 1024 * 1024;

export function workspaceRoot(cwd: string): string {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim();
  } catch {
    throw new UsageError('not inside a git workspace', 'run gm from a game workspace');
  }
}

/**
 * The game's own folder: the nearest directory from `cwd` up to the workspace root holding a `gm.manifest.json`.
 * A one-game repository answers its root; a monorepo (Open-Games: `games/<slug>/`) answers the game's folder, so a
 * game's ledger and rules never leak to its siblings.
 */
export function gameDir(cwd: string, root: string = workspaceRoot(cwd)): string {
  let dir = resolve(cwd);
  const top = resolve(root);
  while (dir.startsWith(top)) {
    if (existsSync(join(dir, 'gm.manifest.json'))) return dir;
    if (dir === top) break;
    dir = dirname(dir);
  }
  return top;
}

export function jobContext(options: { cwd: string; job?: string; environmentJob?: string | null }): {
  root: string;
  jobId: string;
} {
  const { root, jobId } = optionalJobContext(options);
  if (!jobId)
    throw new UsageError(
      'no job id: pass --job or run inside a build workspace',
      'gm chat post --job <id> --text "<one line>"',
    );
  return { root, jobId };
}

// The job when one is named (by flag, `GM_JOB` or `.gm/context/job.json`), else null: a host checkout or an aiur
// workspace has no build job.
export function optionalJobContext(options: { cwd: string; job?: string; environmentJob?: string | null }): {
  root: string;
  jobId: string | null;
} {
  const root = workspaceRoot(options.cwd);
  let jobId = options.job?.trim() || options.environmentJob?.trim();
  const contextFile = join(root, '.gm', 'context', 'job.json');
  if (!jobId) {
    let contents: string | undefined;
    try {
      contents = readFileSync(contextFile, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // No context file: no job, which `jobContext` refuses with both supported ways to supply one.
      } else {
        throw new CommandError(`cannot read ${contextFile}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (contents !== undefined) {
      try {
        const parsed = JSON.parse(contents) as { job_id?: unknown };
        if (typeof parsed.job_id === 'string') jobId = parsed.job_id.trim();
      } catch {
        throw new UsageError(`${contextFile} is not valid JSON`, 'gm chat post --job <id> --text "<one line>"');
      }
    }
  }
  if (!jobId) return { root, jobId: null };
  if (!Id.safeParse(jobId).success)
    throw new UsageError(`invalid job id "${jobId}"`, 'use the job id from .gm/context/job.json');
  return { root, jobId };
}

export function appendOutboxLine(
  root: string,
  file: 'chat.jsonl' | 'checkpoint.jsonl' | 'scope.jsonl',
  input: AgentOutboxLineValue,
): void {
  const line = `${JSON.stringify(AgentOutboxLine.parse(input))}\n`;
  const bytes = Buffer.byteLength(line);
  if (bytes > MAX_LINE_BYTES)
    throw new UsageError(`outbox line exceeds ${MAX_LINE_BYTES} bytes`, 'shorten the message or options');
  const directory = join(root, '.gm', 'outbox');
  const path = join(directory, file);
  let handle: number | undefined;
  try {
    mkdirSync(directory, { recursive: true });
    handle = openSync(path, constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY, 0o600);
    if (writeSync(handle, line) !== bytes) throw new Error('short write');
  } catch (error) {
    throw new CommandError(`cannot append ${path}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (handle !== undefined) closeSync(handle);
  }
}

export function copyOutboxMedia(root: string, source: string, kind: 'image' | 'clip' | 'poster'): string {
  const absolute = resolve(root, source);
  const expected = kind === 'clip' ? '.mp4' : '.png';
  if (extname(absolute).toLowerCase() !== expected)
    throw new UsageError(`${kind} must be a ${expected.slice(1)} file`, `choose a ${expected} file`);
  let handle: number | undefined;
  let size: number;
  try {
    const canonical = realpathSync(absolute);
    const fromRoot = relative(realpathSync(root), canonical);
    if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot))
      throw new UsageError(`${kind} must be inside the workspace`, `copy the ${kind} into the game workspace`);
    handle = openSync(canonical, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stats = fstatSync(handle);
    if (!stats.isFile()) throw new Error('not a file');
    size = stats.size;
  } catch (error) {
    if (handle !== undefined) closeSync(handle);
    if (error instanceof UsageError) throw error;
    throw new UsageError(`${kind} file not found: ${source}`, `check the ${kind} path`);
  }
  if (kind === 'clip' && size > MAX_CLIP_BYTES) {
    closeSync(handle);
    throw new UsageError('clip exceeds 25 MiB', 'trim or compress the clip to 25 MiB or less');
  }

  let bytes: Buffer;
  try {
    bytes = readFileSync(handle);
  } catch (error) {
    throw new CommandError(`cannot read ${source}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    closeSync(handle);
  }
  const relativePath = `.gm/outbox/media/${createHash('sha256').update(bytes).digest('hex')}${expected}`;
  const destination = join(root, relativePath);
  try {
    mkdirSync(join(root, '.gm', 'outbox', 'media'), { recursive: true });
    writeFileSync(destination, bytes, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      try {
        if (readFileSync(destination).equals(bytes)) return relativePath;
      } catch (readError) {
        throw new CommandError(
          `cannot verify existing media at ${destination}: ${readError instanceof Error ? readError.message : String(readError)}`,
        );
      }
      throw new CommandError(`existing media at ${destination} does not match its content hash`);
    }
    throw new CommandError(
      `cannot copy media to ${destination}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return relativePath;
}

export function knownChatMessageIds(root: string, jobId: string): Set<string> {
  const file = join(root, '.gm', 'outbox', 'chat.jsonl');
  let contents: string;
  try {
    contents = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Set();
    throw new CommandError(`cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const ids = new Set<string>();
  for (const raw of contents.split('\n')) {
    if (!raw.trim()) continue;
    try {
      const parsed = AgentOutboxLine.safeParse(JSON.parse(raw));
      if (
        parsed.success &&
        parsed.data.type === 'chat.post' &&
        parsed.data.job_id === jobId &&
        ChatPostPayload.safeParse(parsed.data.payload).success
      )
        ids.add(parsed.data.id);
    } catch {
      // A malformed prior line is not a valid media candidate.
    }
  }
  return ids;
}
