import { ClientEventBatch } from '@ogm/contracts/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { breadcrumb, flush, installTelemetry, reportCrash, RESUME_AFTER_MS } from './telemetry';

type Sent = { events: { kind: string; [key: string]: unknown }[] };

let fetchMock: ReturnType<typeof vi.fn>;
let beaconMock: ReturnType<typeof vi.fn>;
const sent: Sent[] = [];
let uninstall: (() => void) | undefined;

function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  sent.length = 0;
  fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)) as Sent);
    return new Response(null, { status: 202 });
  });
  beaconMock = vi.fn((_url: string, body: Blob) => {
    const reader = new FileReader();
    reader.onload = () => sent.push(JSON.parse(String(reader.result)) as Sent);
    reader.readAsText(body);
    return true;
  });
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: beaconMock });
});

afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  flush();
  vi.unstubAllGlobals();
  setVisibility('visible');
});

const kinds = () => sent.flatMap((batch) => batch.events.map((event) => event.kind));

describe('telemetry', () => {
  /* The Executor wakes on this event to check the path Kevin is about to use. */
  it('reports the app opening once per load, in a batch the API accepts', () => {
    uninstall = installTelemetry();
    flush();
    expect(kinds()).toEqual(['app_open']);
    expect(ClientEventBatch.safeParse(sent[0]).success).toBe(true);
    expect(sent[0]!.events[0]).toMatchObject({ resumed: false, origin: location.origin });
  });

  it('ends the session by beacon when the app is hidden, and counts a long absence as opening it again', async () => {
    let now = 1_000;
    uninstall = installTelemetry(window, () => now);
    flush();
    setVisibility('hidden');
    await vi.waitFor(() => expect(kinds()).toEqual(['app_open', 'session_end']));
    expect(beaconMock).toHaveBeenCalled();

    now += 60_000;
    setVisibility('visible');
    flush();
    expect(kinds()).toEqual(['app_open', 'session_end']);

    setVisibility('hidden');
    now += RESUME_AFTER_MS;
    setVisibility('visible');
    flush();
    // Beacons land asynchronously, so compare without order.
    await vi.waitFor(() => expect(kinds().sort()).toEqual(['app_open', 'app_open', 'session_end', 'session_end']));
    expect(sent.flatMap((batch) => batch.events).filter((event) => event.kind === 'app_open')).toEqual([
      expect.objectContaining({ resumed: false }),
      expect.objectContaining({ resumed: true }),
    ]);
  });

  it('sends a crash with the breadcrumbs leading up to it, once per distinct failure', () => {
    breadcrumb('open game g_1 build b_1');
    breadcrumb('bridge ready');
    for (let i = 0; i < 5; i += 1) {
      reportCrash({ crash: 'game_error', message: 'TypeError: helm', gameId: 'g_1', buildId: 'b_1', step: 'in-world' });
    }
    flush();
    expect(kinds()).toEqual(['crash']);
    const [event] = sent[0]!.events;
    expect(event).toMatchObject({ crash: 'game_error', step: 'in-world', gameId: 'g_1', buildId: 'b_1' });
    expect(event!.breadcrumbs).toEqual(expect.arrayContaining(['open game g_1 build b_1', 'bridge ready']));
    expect(ClientEventBatch.safeParse(sent[0]).success).toBe(true);
  });

  /* A crash storm is when the first crash matters most: no batch may exceed the API's 64 KB body limit. */
  it('splits a burst of large crashes into batches the API accepts', () => {
    for (let i = 0; i < 20; i += 1) {
      for (let crumb = 0; crumb < 20; crumb += 1) breadcrumb(`${i}-${crumb} ${'ä'.repeat(100)}`);
      reportCrash({ crash: 'game_error', message: `burst ${i}`, stack: 'ü'.repeat(4000), gameId: 'g_1' });
    }
    flush();
    expect(sent.flatMap((batch) => batch.events)).toHaveLength(20);
    for (const batch of sent) {
      expect(new TextEncoder().encode(JSON.stringify(batch)).length).toBeLessThan(64 * 1024);
      expect(ClientEventBatch.safeParse(batch).success).toBe(true);
    }
  });

  it('reports a failed lazy chunk load', () => {
    uninstall = installTelemetry();
    window.dispatchEvent(
      Object.assign(new Event('vite:preloadError'), { payload: new Error('Failed to fetch /x.js') }),
    );
    flush();
    expect(sent.flatMap((batch) => batch.events).find((event) => event.kind === 'crash')).toMatchObject({
      crash: 'chunk_load_failed',
      message: 'Error: Failed to fetch /x.js',
    });
  });

  it('never throws into the app when the network is down', () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    reportCrash({ crash: 'shell_error', message: 'offline test' });
    expect(() => flush()).not.toThrow();
  });
});
