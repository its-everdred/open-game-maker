import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { sha256 } from './scope.js';
import { blobId } from '../commands/look/check.js';
import { UsageError } from '../command.js';

export function captureMetadataPath(cwd: string, file: string): string {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim();
  const path = relative(root, file).split(sep).join('/');
  return join(root, '.gm/captures', `${sha256(path)}.json`);
}

/** A capture is attestable only if the tracked checkout remains unchanged throughout the run. */
export function cleanHead(cwd: string, outputPaths: string[] = []): string | undefined {
  try {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim();
    const excludes = outputPaths.map((path) => `:(top,exclude)${relative(root, path).split(sep).join('/')}`);
    execFileSync('git', ['diff', '--quiet', 'HEAD', '--', '.', ...excludes], { cwd: root, stdio: 'ignore' });
    const files = (args: string[]) =>
      execFileSync('git', ['ls-files', '-z', ...args], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      }).split('\0');
    const untracked = files(['--others', '--exclude-standard']);
    const ignoredBuildPaths = files([
      '--others',
      '--ignored',
      '--exclude-standard',
      '--',
      'src',
      'public',
      'assets',
      ':(glob)**/src/**',
      ':(glob)**/public/**',
      ':(glob)**/assets/**',
      ':(exclude,glob)**/node_modules/**',
      ':(exclude,glob)**/dist/**',
    ]);
    const buildInput = (path: string) =>
      !/(?:^|\/)(?:\.gm(?:-mock)?|shots?|looks?|review|node_modules|dist)(?:\/|$)/.test(path) &&
      /\.(?:[cm]?[jt]sx?|html?|css|s[ac]ss|json|glsl|wgsl|png|jpe?g|webp|gif|svg|avif|glb|gltf|ktx2?|basis|hdr|exr)$/i.test(
        path,
      );
    if (untracked.some(buildInput) || ignoredBuildPaths.some(buildInput)) return undefined;
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

/** Build from a clean commit before accepting a capture as evidence for that commit. */
export function prepareVerifiedSource(cwd: string, build: () => void): string {
  const source = cleanHead(cwd);
  if (!source)
    throw new UsageError(
      'source verification requires committed tracked changes',
      'commit changes, then run gm run --verify-source',
    );
  try {
    build();
  } catch {
    throw new UsageError('game build failed during source verification', 'run pnpm run build to inspect the failure');
  }
  if (cleanHead(cwd) !== source)
    throw new UsageError('source changed during the build', 'commit changes, then run gm run --verify-source');
  return source;
}

export function recordRunProvenance(
  cwd: string,
  reportPath: string,
  frames: { path: string }[],
  source: string | undefined,
): void {
  const out = dirname(reportPath);
  const outputs = [reportPath, ...frames.map((frame) => resolve(out, frame.path))];
  if (!source || cleanHead(cwd, outputs) !== source) return;
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim();
  const files = frames
    .map((frame) => resolve(out, frame.path))
    .filter((file) => !relative(out, file).startsWith('..') && existsSync(file));
  const captured = Object.fromEntries(
    files.map((file) => [relative(root, file).split(sep).join('/'), blobId(readFileSync(file))]),
  );
  for (const file of files) {
    const metadata = captureMetadataPath(cwd, file);
    mkdirSync(dirname(metadata), { recursive: true });
    writeFileSync(
      metadata,
      JSON.stringify({ source, blob: captured[relative(root, file).split(sep).join('/')], outputs: captured }) + '\n',
    );
  }
}
