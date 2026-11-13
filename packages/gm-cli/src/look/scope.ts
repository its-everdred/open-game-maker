import { execFileSync } from 'node:child_process';
import { posix, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

export const SCOPE = 'design/look-scope.json';
export type LookProof = { time: number; refs: { path: string; blob: string }[]; answerHash: string };
export type StillEvidence = { path: string; image: string; blob: string; answer: string; proof: LookProof };
export type ScopeEntry = {
  target: string;
  targetHash: string;
  targetImage: string;
  sheetStill: string;
  sheet: string;
  sheetBlob: string;
  answer: string;
  proof: LookProof;
  stills: StillEvidence[];
};
export type Scope = { source: string; inputs: Record<string, string>; screens: Record<string, ScopeEntry> };
export const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');

/** Visual paths in the ticket's diff, with their committed object IDs (or deletion markers). */
export function visualInputs(root: string, game: string, ancestor: string): Record<string, string> {
  const prefix = relative(root, game).split(sep).join('/');
  const changed = execFileSync('git', ['diff', '--name-only', '-z', ancestor, 'HEAD', '--'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean);
  const inputs: Record<string, string> = {};
  for (const path of changed.sort()) {
    const local = prefix ? (path.startsWith(`${prefix}/`) ? path.slice(prefix.length + 1) : '') : path;
    const visualPath =
      /(?:^|\/)(?:screens?|scenes?|ui|app|components?|main|game|samplers?|visuals?|assets?|art|public|images?|materials?|shaders?|fonts?|tiles?|backgrounds?|sprites?|textures?|models?|shots?|renders?|renderer|draw(?:ing)?|look)(?:\/|\.|$)/i.test(
        local,
      );
    const visualAsset = /\.(?:png|jpe?g|webp|gif|svg|avif|glb|gltf|ktx2?|basis|hdr|exr|vert|frag|glsl|wgsl)$/i.test(
      local,
    );
    const entrypoint = /^src\/index\.[cm]?[jt]sx?$/i.test(local);
    if (!local || local.startsWith('review/') || (!visualPath && !visualAsset && !entrypoint)) continue;
    try {
      inputs[path] = execFileSync('git', ['rev-parse', `HEAD:${path}`], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      inputs[path] = 'deleted';
    }
  }
  return inputs;
}

/** Verify tracked target and symlink-chain bytes without requiring ignored target files in a checkout. */
export function trackedTargetMatches(root: string, source: string, target: string, expected: string): boolean {
  const blob = (ref: string, path: string): Buffer | undefined => {
    const listing = execFileSync('git', ['ls-tree', ref, '--', path], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (!listing) return undefined;
    return execFileSync('git', ['show', `${ref}:${path}`], {
      cwd: root,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  };
  let path = target;
  const seen = new Set<string>();
  for (let i = 0; i < 16; i++) {
    if (path.startsWith('../') || posix.isAbsolute(path) || seen.has(path)) return false;
    seen.add(path);
    const parts = path.split('/');
    let redirected = false;
    for (let n = 1; n <= parts.length; n++) {
      const prefix = parts.slice(0, n).join('/');
      const line = execFileSync('git', ['ls-tree', 'HEAD', '--', prefix], { cwd: root, encoding: 'utf8' });
      const sourceLine = execFileSync('git', ['ls-tree', source, '--', prefix], { cwd: root, encoding: 'utf8' });
      if (!line.startsWith('120000 ') && !sourceLine.startsWith('120000 ')) continue;
      if (!line.startsWith('120000 ') || !sourceLine.startsWith('120000 ')) return false;
      const old = blob(source, prefix);
      const current = blob('HEAD', prefix);
      if (!old || !current || !old.equals(current)) return false;
      const link = current.toString('utf8');
      if (posix.isAbsolute(link)) return false;
      path = posix.normalize(posix.join(posix.dirname(prefix), link, ...parts.slice(n)));
      redirected = true;
      break;
    }
    if (redirected) continue;
    const old = blob(source, path);
    const current = blob('HEAD', path);
    return current ? sha256(current) === expected : !old;
  }
  return false;
}
