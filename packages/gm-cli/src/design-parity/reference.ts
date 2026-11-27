import { createHash } from 'node:crypto';

/** Fail closed when an approved reference has changed without its reviewed manifest. */
export function verifyGlassReference(reference: Buffer, manifest: unknown, file: string): void {
  if (!Array.isArray(manifest)) throw new Error('Invalid glass reference manifest');
  const matches = manifest.filter(
    (entry: unknown) => typeof entry === 'object' && entry !== null && 'file' in entry && entry.file === file,
  );
  const entry = matches[0] as { pngSha256?: unknown } | undefined;
  if (
    matches.length !== 1 ||
    typeof entry?.pngSha256 !== 'string' ||
    createHash('sha256').update(reference).digest('hex') !== entry.pngSha256
  )
    throw new Error(`Reference hash mismatch: ${file}`);
}
