import { JSDOM } from 'jsdom';
import { envelope, gameManifestSchema, gameToHostSchema, type Envelope } from '@ogm/contracts';
import { openHostBridge } from '@ogm/iframe-bridge';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { boot } from './boot.js';
import { createCounterGame } from '../test/fixtures/counter-game.js';

const gameHelloSchema = envelope(
  'hello',
  z.looseObject({ protocol: z.number().int().min(1), manifest: gameManifestSchema }),
);
const gameBridgeInboundSchema = z.union([gameHelloSchema, gameToHostSchema]);

describe('boot bridge integration', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('boots across host and game windows and serves test requests', async () => {
    const hostDom = new JSDOM('', { url: 'https://app.test' });
    const gameDom = new JSDOM('', { url: 'https://games.test' });
    const hostWindow = hostDom.window;
    const gameWindow = gameDom.window;
    Object.defineProperty(gameWindow, 'parent', { value: hostWindow });
    hostWindow.postMessage = ((data: unknown) => {
      hostWindow.dispatchEvent(
        new hostWindow.MessageEvent('message', {
          data,
          origin: 'https://games.test',
          source: gameWindow as unknown as Window,
        }),
      );
    }) as typeof hostWindow.postMessage;
    gameWindow.postMessage = ((data: unknown, _origin: string, transfer?: Transferable[]) => {
      gameWindow.dispatchEvent(
        new gameWindow.MessageEvent('message', {
          data,
          origin: 'https://app.test',
          source: hostWindow as unknown as Window,
          ports: transfer as MessagePort[],
        }),
      );
    }) as typeof gameWindow.postMessage;

    vi.stubGlobal('window', hostWindow);
    const host = openHostBridge({ contentWindow: gameWindow } as unknown as HTMLIFrameElement, {
      gameOrigin: 'https://games.test',
      validate: (raw) => {
        const parsed = gameBridgeInboundSchema.safeParse(raw);
        return parsed.success ? parsed.data : null;
      },
      onMessage: vi.fn(),
      hello: {
        v: 1,
        id: 'host-hello',
        t: 'hello',
        payload: { protocol: 1, capabilities: [], mode: 'test', build: 'test', playerIndex: 0 },
      },
    });

    vi.stubGlobal('window', gameWindow);
    const { module } = createCounterGame();
    const runtime = await boot(module, { hostOrigin: 'https://app.test', build: 'test', headless: true });
    await host.ready;
    const response = await host.request<Envelope<'test.result', { ok: boolean }>>({
      v: 1,
      id: 'advance-1',
      t: 'test.advanceTime',
      payload: { ms: 1000 },
    });

    expect(response.payload.ok).toBe(true);
    expect(response.replyTo).toBe('advance-1');
    expect(runtime.clock.tick).toBe(60);
    runtime.instance.screenToWorld = (x, y) => [x * 10, 0, y * 10];
    const projected = await host.request<Envelope<'editor.projected', { position: [number, number, number] | null }>>({
      v: 1,
      id: 'project-1',
      t: 'editor.project',
      payload: { x: 0.25, y: 0.75 },
    });
    expect(projected.replyTo).toBe('project-1');
    expect(projected.payload.position).toEqual([2.5, 0, 7.5]);
    delete runtime.instance.screenToWorld;
    const missed = await host.request<Envelope<'editor.projected', { position: null }>>({
      v: 1,
      id: 'project-2',
      t: 'editor.project',
      payload: { x: 0.5, y: 0.5 },
    });
    expect(missed.payload.position).toBeNull();
    runtime.dispose();
    host.close();
    hostDom.window.close();
    gameDom.window.close();
  });
});
