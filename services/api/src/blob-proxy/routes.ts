import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { serveBlob, type BlobHash } from '@ogm/blob-store';
import type { ApiBindings } from '../app/types.js';

export const prefix = '/api/v1/blobs';

// Preserve the original signed query; serveBlob remains the authority for signature, expiry and content type.
export default new Hono<ApiBindings>().get('/sha256/:hex', async (c) => {
  const hex = c.req.param('hex');
  if (!/^[0-9a-f]{64}$/u.test(hex)) return c.notFound();
  const { blobStore, config } = c.get('deps');
  const canonical = new URL((await blobStore.signedGet(`sha256:${hex}` as BlobHash, new Date())).url);
  canonical.search = new URL(c.req.url).search;
  const result = await serveBlob(blobStore, config.blobSigningKey, canonical);
  const body = result.stream ? (Readable.toWeb(result.stream as Readable) as ReadableStream) : null;
  return new Response(body, { status: result.status, headers: result.headers });
});
