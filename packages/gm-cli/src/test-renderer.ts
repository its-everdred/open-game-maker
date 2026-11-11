import { existsSync, readdirSync } from 'node:fs';

/** Linux exposes hardware rendering through DRM render nodes or the NVIDIA device. */
export function testSoftwareRenderer(
  configured: boolean | undefined,
  platform = process.platform,
  exists = existsSync,
  readDir: (path: string) => string[] = readdirSync,
): boolean {
  if (configured !== undefined) return configured;
  if (platform !== 'linux') return false;
  if (exists('/dev/nvidiactl')) return false;
  try {
    return !readDir('/dev/dri').some((entry) => /^renderD\d+$/.test(entry));
  } catch {
    return true;
  }
}
