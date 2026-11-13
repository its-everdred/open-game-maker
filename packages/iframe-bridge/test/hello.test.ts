import { afterEach, describe, expect, it, vi } from 'vitest';

import { BridgeError } from '../src/errors.js';
import { openGameBridge } from '../src/game.js';
import { openHostBridge } from '../src/host.js';
import { closePorts, hello, message, nextData, ports, validate } from './helpers.js';

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('host handshake', () => {
  it('accepts an opaque preview only from its exact iframe and transfers to the opaque target', async () => {
    const iframe = document.createElement('iframe');
    document.body.append(iframe);
    const post = vi.spyOn(iframe.contentWindow!, 'postMessage').mockImplementation(() => undefined);
    const bridge = openHostBridge(iframe, {
      gameOrigin: 'https://games.test',
      opaqueOrigin: true,
      validate,
      onMessage: vi.fn(),
      hello: hello('host-hello'),
    });
    window.dispatchEvent(
      new MessageEvent('message', { data: JSON.stringify(hello('forged')), origin: 'null', source: window }),
    );
    expect(post).not.toHaveBeenCalled();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify(hello('game-hello')),
        origin: 'null',
        source: iframe.contentWindow,
      }),
    );
    await bridge.ready;
    expect(post).toHaveBeenCalledWith(JSON.stringify(hello('host-hello')), '*', [expect.anything()]);
    bridge.close();
  });
  it('rejects sends and requests until the handshake finishes', async () => {
    const iframe = document.createElement('iframe');
    document.body.append(iframe);
    const bridge = openHostBridge(iframe, {
      gameOrigin: 'https://games.test',
      validate,
      onMessage: vi.fn(),
      hello: hello('host-hello'),
    });

    expect(() => bridge.send(message('early-send'))).toThrowError(new BridgeError('not_ready'));
    await expect(bridge.request(message('early-request'))).rejects.toEqual(new BridgeError('not_ready'));
    bridge.close();
    await expect(bridge.ready).rejects.toEqual(new BridgeError('closed'));
  });

  it.each([
    ['wrong origin', 'https://evil.test', undefined],
    ['wrong source', 'https://games.test', window],
  ])('silently ignores a hello from the %s', async (_label, origin, source) => {
    const iframe = document.createElement('iframe');
    document.body.append(iframe);
    const post = vi.spyOn(iframe.contentWindow!, 'postMessage');
    const bridge = openHostBridge(iframe, {
      gameOrigin: 'https://games.test',
      validate,
      onMessage: vi.fn(),
      hello: hello('host-hello'),
    });
    let settled = false;
    void bridge.ready.then(
      () => (settled = true),
      () => undefined,
    );

    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify(hello('game-hello')),
        origin,
        source: source ?? iframe.contentWindow,
      }),
    );
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(post).not.toHaveBeenCalled();
    bridge.close();
    await expect(bridge.ready).rejects.toEqual(new BridgeError('closed'));
  });

  it('validates the hello, transfers one port, and removes its listener', async () => {
    const iframe = document.createElement('iframe');
    document.body.append(iframe);
    const post = vi.spyOn(iframe.contentWindow!, 'postMessage').mockImplementation(() => undefined);
    const remove = vi.spyOn(window, 'removeEventListener');
    const onMessage = vi.fn();
    const bridge = openHostBridge(iframe, {
      gameOrigin: 'https://games.test',
      validate,
      onMessage,
      hello: hello('host-hello'),
    });

    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify(hello('game-hello')),
        origin: 'https://games.test',
        source: iframe.contentWindow,
      }),
    );
    await bridge.ready;

    expect(post).toHaveBeenCalledWith(JSON.stringify(hello('host-hello')), 'https://games.test', [expect.anything()]);
    expect(remove).toHaveBeenCalledWith('message', expect.any(Function));
    await vi.waitFor(() => expect(onMessage).toHaveBeenCalledWith(hello('game-hello')));
    bridge.close();
  });
});

describe('game handshake', () => {
  it('posts hello to the exact host origin and uses the transferred port', async () => {
    const post = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);
    const [gamePort, hostPort] = ports();
    const bridge = openGameBridge({
      hostOrigin: 'https://app.test',
      validate,
      onMessage: vi.fn(),
      helloPayload: { protocol: 1 },
    });

    expect(post).toHaveBeenCalledWith(expect.stringContaining('"t":"hello"'), 'https://app.test');
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify(hello('host-hello')),
        origin: 'https://app.test',
        ports: [gamePort],
      }),
    );
    await bridge.ready;
    const received = nextData(hostPort);
    bridge.send(message('over-port'));

    expect(JSON.parse((await received) as string)).toEqual(message('over-port'));
    bridge.close();
    closePorts(hostPort);
  });

  it('ignores a transferred port from the wrong origin', async () => {
    vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);
    const [wrongPort, wrongPeer] = ports();
    const [rightPort, rightPeer] = ports();
    const bridge = openGameBridge({
      hostOrigin: 'https://app.test',
      validate,
      onMessage: vi.fn(),
      helloPayload: {},
    });

    window.dispatchEvent(
      new MessageEvent('message', { data: JSON.stringify(hello()), origin: 'https://evil.test', ports: [wrongPort] }),
    );
    window.dispatchEvent(
      new MessageEvent('message', { data: JSON.stringify(hello()), origin: 'https://app.test', ports: [rightPort] }),
    );

    await bridge.ready;
    bridge.close();
    closePorts(wrongPort, wrongPeer, rightPeer);
  });

  it('retries 20 times and rejects ready when no port arrives', async () => {
    vi.useFakeTimers();
    const post = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);
    const bridge = openGameBridge({
      hostOrigin: 'https://app.test',
      validate,
      onMessage: vi.fn(),
      helloPayload: {},
    });
    const rejection = expect(bridge.ready).rejects.toEqual(new BridgeError('timeout'));

    await vi.advanceTimersByTimeAsync(5000);

    await rejection;
    expect(post).toHaveBeenCalledTimes(20);
  });
});
