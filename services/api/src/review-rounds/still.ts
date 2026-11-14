import type { BlobHash, BlobStore } from '@ogm/blob-store';
import { probeImage } from '../build-chat/media.js';

export async function isReviewStill(store: BlobStore, ref: string): Promise<boolean> {
  if (!/^sha256:[0-9a-f]{64}$/u.test(ref)) return false;
  const blob = await store.open(ref as BlobHash);
  if (!blob || !['image/png', 'image/jpeg', 'image/webp'].includes(blob.ref.mime) || blob.ref.bytes > 16 * 1024 * 1024)
    return false;
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of blob.stream) {
      const bytes = Buffer.from(chunk as Uint8Array);
      size += bytes.length;
      if (size > 16 * 1024 * 1024) return false;
      chunks.push(bytes);
    }
    const image = await probeImage(Buffer.concat(chunks));
    return image.mime === blob.ref.mime;
  } catch {
    return false;
  }
}
