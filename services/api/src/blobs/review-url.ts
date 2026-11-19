import type { BlobHash, BlobStore } from '@ogm/blob-store';

// Review media must use the app's public origin: browsers block requests from that public origin to a private API IP.
export async function reviewMediaUrl(store: BlobStore, appOrigin: string, hash: BlobHash): Promise<string> {
  const signed = new URL((await store.signedGet(hash, new Date(Date.now() + 3_600_000))).url);
  const proxy = new URL(`/api/v1/blobs/sha256/${hash.slice('sha256:'.length)}`, appOrigin);
  proxy.search = signed.search;
  return proxy.toString();
}
