import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type BugReport = typeof import('./index');

let bug: BugReport;
const QUEUE = 'ogm.reports.queue';
const queued = () => JSON.parse(localStorage.getItem(QUEUE) ?? '[]') as unknown[];
const created = () =>
  new Response(JSON.stringify({ reportId: 'r1', signature: 's', route: 'platform' }), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  });

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  bug = await import('./index');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('sendReport', () => {
  it('files the report with the screen context and leaves nothing queued', async () => {
    const fetchMock = vi.fn(async () => created());
    vi.stubGlobal('fetch', fetchMock);
    bug.setBugContext({ gameId: 'g1', releaseId: 'rel1', buildHash: 'abc' });

    await expect(bug.sendReport({ text: 'the door is stuck' })).resolves.toEqual({
      reportId: 'r1',
      signature: 's',
      route: 'platform',
    });

    expect(queued()).toEqual([]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/reports');
    expect(JSON.parse(init.body as string)).toEqual({
      gameId: 'g1',
      releaseId: 'rel1',
      buildHash: 'abc',
      text: 'the door is stuck',
    });
  });

  it('sends recent game captures with the report for image-capable report routes', async () => {
    const fetchMock = vi.fn(async () => created());
    vi.stubGlobal('fetch', fetchMock);
    bug.setBugContext({ gameId: 'g1', releaseId: 'rel1', buildHash: 'abc' });
    const captures = [{ label: 'Now', image: 'data:image/webp;base64,YWJj' }];

    await bug.sendReport({ text: 'the door is stuck', captures });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ captures });
  });

  it('keeps the report when the network is down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    await expect(bug.sendReport({ text: 'the door is stuck' })).resolves.toEqual({ queued: true });

    expect(queued()).toEqual([{ text: 'the door is stuck' }]);
  });

  it('does not persist screenshots in the account-agnostic offline queue', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);
    const captures = [{ label: 'Now', image: 'data:image/webp;base64,YWJj' }];

    await expect(bug.sendReport({ text: 'the door is stuck', captures })).resolves.toEqual({ queued: true });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ captures });
    expect(queued()).toEqual([{ text: 'the door is stuck' }]);
  });

  it('keeps the composer informed when offline report storage fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });

    await expect(bug.sendReport({ text: 'the door is stuck' })).rejects.toThrow('report_queue_unavailable');
  });

  it('keeps the report while the reports route is not deployed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 })),
    );

    await expect(bug.sendReport({ text: 'x' })).resolves.toEqual({ queued: true });
    expect(queued()).toHaveLength(1);
  });

  it('does not queue a report the server rejected as invalid', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 400 })),
    );

    await expect(bug.sendReport({ text: 'x' })).rejects.toMatchObject({ status: 400 });
    expect(queued()).toEqual([]);
  });
});

describe('flushQueue', () => {
  it('sends a report kept from an earlier visit and clears it', async () => {
    localStorage.setItem(QUEUE, JSON.stringify([{ text: 'from last time' }]));
    const fetchMock = vi.fn(async () => created());
    vi.stubGlobal('fetch', fetchMock);

    await bug.flushQueue();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(localStorage.getItem(QUEUE)).toBeNull();
  });

  it('keeps it for the next load while the route is still unreachable', async () => {
    localStorage.setItem(QUEUE, JSON.stringify([{ text: 'from last time' }]));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 })),
    );

    await bug.flushQueue();

    expect(queued()).toEqual([{ text: 'from last time' }]);
  });
});

describe('error capture', () => {
  it('includes route and game context when a screen boundary catches an error', async () => {
    const fetchMock = vi.fn(async () => created());
    vi.stubGlobal('fetch', fetchMock);

    bug.captureError(new RangeError('bad tile'), { route: '/games', gameId: 'g1' });
    await bug.sendReport({});

    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.gameId).toBe('g1');
    expect(body.error).toMatchObject({ type: 'RangeError', message: '/games · game g1 — bad tile' });
  });

  it('does not carry an earlier game into a crash on a game-less route', async () => {
    const fetchMock = vi.fn(async () => created());
    vi.stubGlobal('fetch', fetchMock);
    bug.setBugContext({ gameId: 'old-game', buildHash: 'old-build' });

    bug.captureError(new Error('bad form'), { route: '/new' });
    await bug.sendReport({});

    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).not.toHaveProperty('gameId');
    expect(body).not.toHaveProperty('buildHash');
    expect(body.error).toMatchObject({ message: '/new — bad form' });
  });

  it('attaches the last uncaught error summary to the next report', async () => {
    const fetchMock = vi.fn(async () => created());
    vi.stubGlobal('fetch', fetchMock);
    bug.installErrorCapture();
    const error = new RangeError('bad tile');
    window.dispatchEvent(new ErrorEvent('error', { error, message: error.message }));

    await bug.sendReport({ text: 'crashed' });

    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.error).toMatchObject({ type: 'RangeError', message: 'bad tile' });
    expect(body.error.frames.length).toBeLessThanOrEqual(5);
  });
});
