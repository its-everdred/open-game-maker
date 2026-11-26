import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Media } from './cards.ts';

type MediaKind = Media['kind'];
type Encoder = (source: string, output: string, kind: MediaKind) => void;

export function encodeMedia(source: string, output: string, kind: MediaKind, program = 'ffmpeg'): void {
  const args =
    kind === 'img'
      ? ['-frames:v', '1', '-vf', "scale='min(1600,iw)':-2", '-q:v', '3']
      : kind === 'video'
        ? [
            '-vf',
            "scale='min(1280,iw)':-2,format=yuv420p",
            '-c:v',
            'libx264',
            '-profile:v',
            'main',
            '-level:v',
            '4.0',
            '-r',
            '30',
            '-crf',
            '26',
            '-preset',
            'veryfast',
            '-c:a',
            'aac',
            '-b:a',
            '128k',
            '-movflags',
            '+faststart',
          ]
        : ['-c:a', 'libmp3lame', '-q:a', '4'];
  execFileSync(program, ['-y', '-loglevel', 'error', '-i', source, ...args, output], { timeout: 600_000 });
}

export function hashFile(path: string): string {
  const hash = createHash('sha256');
  const file = openSync(path, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let size: number;
    while ((size = readSync(file, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, size));
    return hash.digest('hex');
  } finally {
    closeSync(file);
  }
}

export class MediaStager {
  private readonly output: string;
  private readonly allowedRoots: string[];
  private readonly encode: Encoder;
  private readonly legacyMedia?: string;

  constructor(output: string, allowedRoots: string[], encode: Encoder = encodeMedia, legacyMedia?: string) {
    this.output = output;
    this.allowedRoots = allowedRoots;
    this.encode = encode;
    this.legacyMedia = legacyMedia;
  }

  private permitted(path: string): boolean {
    return this.allowedRoots.some((root) => {
      const rel = relative(realpathSync(root), path);
      return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
    });
  }

  restoreLegacy(path: string): void {
    const destination = join(this.output, path);
    if (existsSync(destination)) return;
    if (!this.legacyMedia) throw new Error(`Missing retained media: ${path}`);
    const source = join(this.legacyMedia, basename(path));
    if (!existsSync(source) || !this.permitted(realpathSync(source)))
      throw new Error(`Missing retained media: ${path}`);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(realpathSync(source), destination);
  }

  stage(path: string, withOriginal = true): Media | undefined {
    if (!isAbsolute(path)) return undefined;
    if (!existsSync(path) && this.legacyMedia && existsSync(this.legacyMedia)) {
      const prefix = `${createHash('sha1').update(path).digest('hex').slice(0, 10)}-`;
      const name = readdirSync(this.legacyMedia)
        .sort()
        .find((item) => item.startsWith(prefix));
      if (name) path = join(this.legacyMedia, name);
    }
    if (!existsSync(path)) return undefined;
    const actual = realpathSync(path);
    if (!this.permitted(actual)) return undefined;
    const ext = extname(actual).toLowerCase();
    const kind = ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)
      ? 'img'
      : ['.mp4', '.webm', '.mov'].includes(ext)
        ? 'video'
        : ['.mp3', '.wav', '.ogg', '.oga', '.m4a'].includes(ext)
          ? 'audio'
          : undefined;
    if (!kind) return undefined;
    const hash = hashFile(actual).slice(0, 20);
    const safeName = basename(actual, extname(actual)).replace(/[^a-zA-Z0-9._-]/g, '-');
    const name = `${hash}-${safeName}${kind === 'img' ? '.jpg' : kind === 'video' ? '.mp4' : '.mp3'}`;
    mkdirSync(join(this.output, 'm'), { recursive: true });
    const destination = join(this.output, 'm', name);
    if (!existsSync(destination)) {
      const temporary = join(this.output, 'm', `.tmp-${process.pid}-${name}`);
      try {
        if (ext === '.mp3') copyFileSync(actual, temporary);
        else this.encode(actual, temporary, kind);
        renameSync(temporary, destination);
      } finally {
        rmSync(temporary, { force: true });
      }
    }
    const media: Media = { kind, src: `m/${name}` };
    const stem = actual.slice(0, -extname(actual).length);
    for (const sidecar of [actual + '.meta.json', stem + '.meta.json']) {
      if (!existsSync(sidecar) || !this.permitted(realpathSync(sidecar))) continue;
      let metadata: Record<string, unknown>;
      try {
        metadata = JSON.parse(readFileSync(sidecar, 'utf8')) as Record<string, unknown>;
      } catch {
        continue;
      }
      const meta: NonNullable<Media['meta']> = {};
      for (const key of ['kind', 'model', 'skill', 'tool'] as const) {
        if (typeof metadata[key] === 'string') meta[key] = metadata[key];
      }
      if (typeof metadata.cost === 'string') meta.cost = metadata.cost;
      else if (typeof (metadata.cost_usd ?? metadata.cost) === 'number')
        meta.cost = `$${Number(metadata.cost_usd ?? metadata.cost).toFixed(2)}`;
      if (typeof metadata.seconds === 'number') meta.time = `${metadata.seconds}s`;
      if (typeof metadata.ai_generated === 'boolean') meta.ai = metadata.ai_generated;
      if (Object.keys(meta).length) media.meta = meta;
      if (withOriginal && kind === 'img' && typeof metadata.original === 'string') {
        const originalPath = resolve(dirname(actual), metadata.original);
        const original = originalPath === actual ? undefined : this.stage(originalPath, false);
        if (original) media.orig = original;
      }
      break;
    }
    const pack = actual.match(/\/assets-local\/packs\/([^/]+)\//)?.[1];
    if (pack) media.meta = { kind: 'pack original', pack, ai: false, ...media.meta };
    return media;
  }
}

export function commandMedia(items: unknown[], paths: Map<string, string>, stager: MediaStager): Media[] {
  return items.flatMap((item) => {
    if (!item || typeof item !== 'object') throw new Error('Invalid Command media');
    const value = item as {
      attachment_id?: string;
      kind?: string;
      locator?: { kind?: string; value?: string; attachment_id?: string };
    };
    const locator = value.locator;
    if (locator?.kind === 'url' && locator.value?.startsWith('https://')) {
      const ext = extname(new URL(locator.value).pathname).toLowerCase();
      const kind =
        ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext) || value.kind === 'image'
          ? 'img'
          : ['.mp4', '.webm'].includes(ext) || value.kind === 'video'
            ? 'video'
            : ['.mp3', '.wav', '.ogg', '.m4a'].includes(ext) || value.kind === 'audio'
              ? 'audio'
              : undefined;
      if (!kind) throw new Error('Unsupported Command media URL');
      return [{ kind, src: locator.value }];
    }
    const path =
      locator?.kind === 'path' ? locator.value : paths.get(locator?.attachment_id ?? value.attachment_id ?? '');
    const media = path && stager.stage(path);
    if (!media) throw new Error('Command media is missing, unsupported, or outside the allowed roots');
    return [media];
  });
}
