import { afterEach, describe, expect, it, vi } from 'vitest';

import { savesListPath, savesPath, type DesignDoc } from '@ogm/contracts/browser';

import {
  getOptionalPublished,
  getDesignSnapshot,
  getFallbackPalette,
  getScenerySource,
  getEditorPreviews,
  getPreviewDesign,
  NO_BUILD_ID,
  getOptionalSaves,
  postAnalyticsEvent,
  postTransaction,
  putSave,
  type TransactionBody,
} from './api';

const gameId = 'g_00000000-0000-4000-8000-000000000001';
const buildId = 'b_01BX5ZZKBKACTAV9WEVGEMMVRZ';

function body(): TransactionBody {
  return {
    baseRev: 4,
    leaseToken: 2,
    kind: 'manual',
    label: 'Move skeleton',
    baseBuildId: buildId,
    commands: [],
    patches: [],
    inverse: [],
    sessionId: 'session-a',
  };
}

function response(status: number, value?: unknown): Response {
  return new Response(value === undefined ? undefined : JSON.stringify(value), {
    status,
    headers: value === undefined ? undefined : { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('editor API classifications', () => {
  it('loads playable previews and the exact preview build design', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(200, { previews: [] }))
      .mockResolvedValueOnce(response(200, { rev: 0, doc: { schemaVersion: 1, globals: {}, entities: {} } }));
    vi.stubGlobal('fetch', fetch);
    await getEditorPreviews(gameId);
    await getPreviewDesign(gameId, '12', 'preview-x');
    expect(fetch).toHaveBeenNthCalledWith(1, `/api/v1/games/${gameId}/editor/previews`, expect.anything());
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      `/api/v1/games/${gameId}/previews/12/design?buildId=preview-x`,
      expect.anything(),
    );
  });
  it('loads a game-scoped request palette', async () => {
    const value = { mode: 'request', palette: { categories: [], items: [] } };
    const fetch = vi.fn().mockResolvedValue(response(200, value));
    vi.stubGlobal('fetch', fetch);
    await expect(getFallbackPalette(gameId)).resolves.toEqual(value);
    expect(fetch).toHaveBeenCalledWith(`/api/v1/games/${gameId}/editor/fallback`, expect.anything());
  });
  it('requests palette assets for the selected build', async () => {
    const fetch = vi.fn().mockResolvedValue(response(200, { scene: {}, assets: [] }));
    vi.stubGlobal('fetch', fetch);
    await getScenerySource(gameId, 'main', 'build/one');
    expect(fetch).toHaveBeenCalledWith(
      `/api/v1/games/${gameId}/scenery/source?branch=main&build=build%2Fone`,
      expect.anything(),
    );
  });
  it('represents an unbuilt snapshot with the reserved empty build id', async () => {
    const doc = { schemaVersion: 1, globals: {}, entities: {} };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(200, { rev: 0, buildId: null, doc })));
    await expect(getDesignSnapshot(gameId, 'main')).resolves.toEqual({ rev: 0, buildId: NO_BUILD_ID, doc });
  });
  it('posts one load activity through the analytics ingest client', async () => {
    const fetch = vi.fn().mockResolvedValue(response(202, { accepted: 1, rejected: [] }));
    vi.stubGlobal('fetch', fetch);
    const event = {
      ts: '2026-11-02T12:00:00.000Z',
      gameId,
      actor: 'human' as const,
      activity: 'playtesting' as const,
      boundary: 'point' as const,
      source: 'editor' as const,
      meta: { system: 'game-load', command: 'hit', count: 0, durationMs: 10, result: 'ok' as const },
    };

    await expect(postAnalyticsEvent(event)).resolves.toEqual({ accepted: 1, rejected: [] });
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/analytics/events',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ events: [event] }) }),
    );
  });

  it('reports 409 as a conflict with the authoritative head revision', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(409, { headRev: 9 })));

    await expect(postTransaction(gameId, 'main', body())).resolves.toEqual({ ok: false, kind: 'conflict', headRev: 9 });
  });

  it('reports 423 as lease loss', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(423, { holder: 'other-session' })));

    await expect(postTransaction(gameId, 'main', body())).resolves.toEqual({
      ok: false,
      kind: 'lease-lost',
      holder: 'other-session',
    });
  });

  it('reports a transport failure as retryable without claiming the write saved', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));

    await expect(postTransaction(gameId, 'main', body())).resolves.toMatchObject({
      ok: false,
      kind: 'retryable',
      message: 'offline',
    });
  });

  it('treats only an exact 404 as an absent optional capability', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(404, { error: 'not_found' }))
      .mockResolvedValueOnce(response(500, { error: 'broken' }));
    vi.stubGlobal('fetch', fetch);

    await expect(getOptionalSaves(gameId)).resolves.toEqual({ available: false });
    await expect(getOptionalSaves(gameId)).rejects.toMatchObject({ status: 500 });
  });

  // The API judges each slot against the build that is playing; without these facts every slot reports `ok`.
  it('lists saves with the running build schema and the version it migrates from', async () => {
    const fetch = vi.fn().mockResolvedValue(response(200, { slots: [] }));
    vi.stubGlobal('fetch', fetch);

    await getOptionalSaves(gameId, { schema: 3, migratesFrom: 2 });

    expect(fetch.mock.calls[0]?.[0]).toBe(`/api/v1${savesListPath(gameId, { schema: 3, migratesFrom: 2 })}`);
    expect(fetch.mock.calls[0]?.[0]).toBe(`/api/v1/games/${gameId}/saves?schema=3&migratesFrom=2`);
  });

  it('omits the migration the build does not implement', async () => {
    const fetch = vi.fn().mockResolvedValue(response(200, { slots: [] }));
    vi.stubGlobal('fetch', fetch);

    await getOptionalSaves(gameId, { schema: 3 });

    expect(fetch.mock.calls[0]?.[0]).toBe(`/api/v1/games/${gameId}/saves?schema=3`);
  });

  it('takes the play lease, then writes a gzipped save in the API wire format', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(200, { expiresAt: '2026-11-02T16:00:30.000Z' }))
      .mockResolvedValueOnce(response(200, { revision: 8 }));
    vi.stubGlobal('fetch', fetch);

    await expect(
      putSave(gameId, '2', { saveSchemaVersion: 1, data: { room: 'crypt' } }, 7, { branch: 'main', buildId }),
    ).resolves.toEqual({ revision: 8 });

    const [leasePath, leaseInit] = fetch.mock.calls[0] as [string, RequestInit];
    expect(leasePath).toBe(`/api/v1${savesPath(gameId)}/lease`);
    const lease = JSON.parse(String(leaseInit.body)) as { deviceId: string; tabId: string };
    expect(lease.deviceId).toMatch(/^device_[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    expect(lease.tabId).toMatch(/^tab_[0-7][0-9A-HJKMNP-TV-Z]{25}$/);

    const [path, init] = fetch.mock.calls[1] as [string, RequestInit];
    expect(path).toBe(`/api/v1${savesPath(gameId, '2')}`);
    expect(path).toBe(`/api/v1/games/${gameId}/saves/2`);
    const headers = new Headers(init.headers);
    expect(Object.fromEntries(headers)).toMatchObject({
      'content-type': 'application/octet-stream',
      'content-encoding': 'gzip',
      'if-match': '7',
      'idempotency-key': expect.stringMatching(new RegExp(`^${lease.deviceId}:\\d+$`)),
      'x-save-schema': '1',
      'x-save-branch': 'main',
      'x-save-build': buildId,
      'x-save-reason': 'checkpoint',
    });
    const unzipped = new Response(
      new Response(init.body as ArrayBuffer).body!.pipeThrough(new DecompressionStream('gzip')),
    );
    expect(await unzipped.json()).toEqual({ saveSchemaVersion: 1, data: { room: 'crypt' } });
  });

  it('creates a slot with if-match 0 and never reuses an idempotency key', async () => {
    const fetch = vi.fn().mockImplementation(async () => response(200, { revision: 1 }));
    vi.stubGlobal('fetch', fetch);
    const save = { saveSchemaVersion: 1, data: {} };

    await putSave(gameId, 'auto', save, undefined, { branch: 'main', buildId });
    await putSave(gameId, 'auto', save, 1, { branch: 'main', buildId });

    const first = new Headers((fetch.mock.calls[1] as [string, RequestInit])[1].headers);
    const second = new Headers((fetch.mock.calls[3] as [string, RequestInit])[1].headers);
    expect(first.get('if-match')).toBe('0');
    expect(second.get('idempotency-key')).not.toBe(first.get('idempotency-key'));
  });

  // The API keeps the reason in each revision's history; the SDK sends it on every save.write.
  it('records the reason the game saved for, and checkpoint when it sent none the API accepts', async () => {
    const fetch = vi.fn().mockImplementation(async () => response(200, { revision: 1 }));
    vi.stubGlobal('fetch', fetch);
    const context = { branch: 'main', buildId };

    await putSave(gameId, 'auto', { saveSchemaVersion: 1, data: {}, reason: 'pause' } as never, 1, context);
    await putSave(gameId, 'auto', { saveSchemaVersion: 1, data: {}, reason: 'bogus' } as never, 2, context);

    const [, paused] = fetch.mock.calls[1] as [string, RequestInit];
    const [, bogus] = fetch.mock.calls[3] as [string, RequestInit];
    expect(new Headers(paused.headers).get('x-save-reason')).toBe('pause');
    expect(new Headers(bogus.headers).get('x-save-reason')).toBe('checkpoint');
  });

  // The API holds the play lease per device: a new device id per save would lock this browser out of its own lease.
  it('keeps one device id across saves, also when storage is unavailable', async () => {
    const fetch = vi.fn().mockImplementation(async () => response(200, { revision: 1 }));
    vi.stubGlobal('fetch', fetch);
    const save = { saveSchemaVersion: 1, data: {} };
    const leaseDevice = (call: number) =>
      (JSON.parse(String((fetch.mock.calls[call] as [string, RequestInit])[1].body)) as { deviceId: string }).deviceId;

    await putSave(gameId, '1', save, 1, { branch: 'main', buildId });
    await putSave(gameId, '1', save, 2, { branch: 'main', buildId });
    expect(leaseDevice(2)).toBe(leaseDevice(0));
    expect(localStorage.getItem('ogm:saves:device')).toBe(leaseDevice(0));

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    try {
      await putSave(gameId, '1', save, 3, { branch: 'main', buildId });
      await putSave(gameId, '1', save, 4, { branch: 'main', buildId });
    } finally {
      vi.restoreAllMocks();
    }
    expect(leaseDevice(6)).toBe(leaseDevice(4));
  });

  it('uses a conditional published request and preserves the ETag on 304', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(undefined, {
        status: 304,
        headers: { etag: '"release-2"' },
      }),
    );
    vi.stubGlobal('fetch', fetch);

    await expect(getOptionalPublished(gameId, '"release-2"')).resolves.toEqual({
      available: true,
      modified: false,
      etag: '"release-2"',
    });
    expect(new Headers((fetch.mock.calls[0]?.[1] as RequestInit).headers).get('if-none-match')).toBe('"release-2"');
  });

  it('refuses an over-cap transaction before calling fetch', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const hugeDoc = { blob: 'x'.repeat(300_000) } satisfies Partial<DesignDoc>;

    await expect(
      postTransaction(gameId, 'main', {
        ...body(),
        patches: [{ op: 'add', path: ['globals', 'huge'], value: hugeDoc }],
      }),
    ).resolves.toEqual({ ok: false, kind: 'invalid', reason: 'patch_too_large' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
