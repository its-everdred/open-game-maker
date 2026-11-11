import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
    const outputNames = new Set(outputPaths.map((path) => relative(root, path).split(sep).join('/')));
    const excludes = [...outputNames].map((path) => `:(top,exclude)${path}`);
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
      !outputNames.has(path) &&
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

/** Refuse an output tree that can redirect a capture through a symlink. */
export function hasCaptureSymlink(out: string): boolean {
  if (!existsSync(out)) return false;
  for (const entry of readdirSync(out, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) return true;
    if (entry.isDirectory() && hasCaptureSymlink(join(out, entry.name))) return true;
  }
  return false;
}

/** Only unchanged files recorded by a previous verified run may be excluded before a rebuild. */
export function captureOutputPaths(cwd: string, out: string): string[] {
  try {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim();
    const manifest = join(root, '.gm/capture-runs', `${sha256(relative(root, out).split(sep).join('/'))}.json`);
    const recorded = JSON.parse(readFileSync(manifest, 'utf8')) as { outputs: Record<string, string> };
    return Object.entries(recorded.outputs).flatMap(([path, blob]) => {
      const file = resolve(root, path);
      if (relative(out, file).startsWith('..') || !existsSync(file) || !lstatSync(file).isFile()) return [];
      return blobId(readFileSync(file)) === blob ? [file] : [];
    });
  } catch {
    return [];
  }
}

/** Build from a clean commit before accepting a capture as evidence for that commit. */
export function prepareVerifiedSource(cwd: string, build: () => void, previousOutputs: string[] = []): string {
  const source = cleanHead(cwd, previousOutputs);
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
  if (cleanHead(cwd, previousOutputs) !== source)
    throw new UsageError('source changed during the build', 'commit changes, then run gm run --verify-source');
  return source;
}

export function recordRunProvenance(
  cwd: string,
  reportPath: string,
  frames: { path: string }[],
  source: string | undefined,
  additionalOutputs: string[] = [],
): void {
  const out = dirname(reportPath);
  const outputs = [
    reportPath,
    join(out, 'state.json'),
    join(out, 'summary.txt'),
    ...frames.map((frame) => resolve(out, frame.path)),
    ...additionalOutputs.map((path) => resolve(out, path)),
  ];
  if (!source || cleanHead(cwd, outputs) !== source) return;
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim();
  const files = frames
    .map((frame) => resolve(out, frame.path))
    .filter((file) => !relative(out, file).startsWith('..') && existsSync(file));
  const captured = Object.fromEntries(
    outputs
      .filter((file) => existsSync(file))
      .map((file) => [relative(root, file).split(sep).join('/'), blobId(readFileSync(file))]),
  );
  const runManifest = join(root, '.gm/capture-runs', `${sha256(relative(root, out).split(sep).join('/'))}.json`);
  mkdirSync(dirname(runManifest), { recursive: true });
  writeFileSync(runManifest, JSON.stringify({ outputs: captured }) + '\n');
  for (const file of files) {
    const metadata = captureMetadataPath(cwd, file);
    mkdirSync(dirname(metadata), { recursive: true });
    writeFileSync(
      metadata,
      JSON.stringify({ source, blob: captured[relative(root, file).split(sep).join('/')], outputs: captured }) + '\n',
    );
  }
}
