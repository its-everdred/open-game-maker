import { extname } from 'node:path';

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.html': 'text/html; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ktx2': 'image/ktx2',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.wav': 'audio/wav',
  '.webp': 'image/webp',
};
const COMPRESSIBLE_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.map', '.mjs']);

export function mimeForPath(filePath: string): string {
  return MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

export function isCompressiblePath(filePath: string): boolean {
  return COMPRESSIBLE_EXTENSIONS.has(extname(filePath).toLowerCase());
}
