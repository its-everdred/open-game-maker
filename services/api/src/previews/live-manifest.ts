import { createHash } from 'node:crypto';
import { opendir } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { openLiveFile } from '@ogm/games-host/live-files';

import { ARCHIVE_LIMITS } from '../builds/untar.js';
import { scanIntegrationText } from '../gameplay/paid-integrations.js';

const MAX_FILE_BYTES = 64 * 1024 * 1024;

/** Scan and hash the same bounded bytes that a capability later permits the host to serve. */
export async function liveManifest(root: string, version: string, allowPaid: boolean): Promise<Record<string, string>> {
  const manifest: Record<string, string> = Object.create(null) as Record<string, string>;
  let total = 0;
  let count = 0;
  const walk = async (prefix: string): Promise<void> => {
    const entries = await opendir(join(root, 'versions', version, prefix));
    for await (const entry of entries) {
      if (++count > ARCHIVE_LIMITS.entries) throw new Error('too many live files');
      const path = posix.join(prefix, entry.name);
      if (path.length > 1024 || entry.isSymbolicLink()) throw new Error('unsafe live file');
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      if (!entry.isFile()) throw new Error('unsafe live file');
      const file = await openLiveFile(root, path, version);
      if (!file) throw new Error('unsafe live file');
      try {
        const size = (await file.stat()).size;
        total += size;
        if (size > MAX_FILE_BYTES || total > ARCHIVE_LIMITS.unpackedBytes) throw new Error('live build too large');
        const bytes = Buffer.alloc(size + 1);
        let offset = 0;
        while (offset < bytes.length) {
          const read = await file.read(bytes, offset, bytes.length - offset, offset);
          if (!read.bytesRead) break;
          offset += read.bytesRead;
        }
        if (offset !== size) throw new Error('live file changed');
        const contents = bytes.subarray(0, size);
        const scan = scanIntegrationText(path, contents);
        if (scan.credential || (scan.paid && !allowPaid)) throw new Error('live build refused');
        manifest[path] = createHash('sha256').update(contents).digest('hex');
      } finally {
        await file.close();
      }
    }
  };
  await walk('');
  return manifest;
}
