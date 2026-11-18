import { roundExpiry } from '@ogm/blob-store';
import { describe, expect, it } from 'vitest';

import { makeApp } from './helpers.js';
import { reviewMediaUrl } from '../src/blobs/review-url.js';

describe('GET /blobs/sha256/:hex', () => {
  it('serves a signed blob from the loopback API and refuses a bad signature', async () => {
    const { app, deps } = await makeApp();
    const ref = await deps.blobStore.put(new TextEncoder().encode('blob bytes'), 'text/plain');
    const { url } = await deps.blobStore.signedGet(ref.hash, new Date(Date.now() + 60_000));
    const { pathname, search } = new URL(url);

    const response = await app.request(`${pathname}${search}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/plain');
    expect(await response.text()).toBe('blob bytes');

    const exp = roundExpiry(new Date());
    const forged = await app.request(`${pathname}?exp=${exp}&sig=${'0'.repeat(64)}`);
    expect(forged.status).toBe(403);
  });
});

describe('review media through the app origin', () => {
  it('serves signed bytes through the API proxy and rejects a forged signature', async () => {
    const { app, deps } = await makeApp();
    const ref = await deps.blobStore.put(new TextEncoder().encode('review media'), 'image/png');
    const url = new URL(await reviewMediaUrl(deps.blobStore, deps.config.appOrigin, ref.hash));
    expect(url.origin).toBe(deps.config.appOrigin);
    expect(url.pathname).toMatch(/^\/api\/v1\/blobs\/sha256\//);
    const response = await app.request(`${url.pathname}${url.search}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(await response.text()).toBe('review media');
    url.searchParams.set('sig', '0'.repeat(64));
    expect((await app.request(`${url.pathname}${url.search}`)).status).toBe(403);
    const expired = new URL((await deps.blobStore.signedGet(ref.hash, new Date(0))).url);
    expect((await app.request(`${url.pathname}${expired.search}`)).status).toBe(403);
    expect((await app.request(url.pathname)).status).toBe(404);
  });
});
