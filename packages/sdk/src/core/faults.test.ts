import { afterEach, describe, expect, it, vi } from 'vitest';

import { installFaultRelay } from './faults.js';

describe('installFaultRelay', () => {
  let stop: (() => void) | undefined;
  afterEach(() => stop?.());

  function relay() {
    const report = vi.fn();
    stop = installFaultRelay(window, report);
    return report;
  }

  /* The shell can't see inside the game frame: these are the crashes Kevin only found by screenshot. */
  it('relays an uncaught error with its stack so the crash can be grouped by top frame', () => {
    const report = relay();
    const error = new TypeError('helm is undefined');
    window.dispatchEvent(new ErrorEvent('error', { error, message: error.message }));
    expect(report).toHaveBeenCalledWith({ kind: 'error', message: 'TypeError: helm is undefined', stack: error.stack });
  });

  it('relays an unhandled rejection', () => {
    const report = relay();
    const event = new Event('unhandledrejection') as Event & { reason: unknown };
    event.reason = new Error('save failed');
    window.dispatchEvent(event);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ kind: 'rejection', message: 'Error: save failed' }));
  });

  it('names a failed asset by path, dropping signed query strings', () => {
    const report = relay();
    const image = document.createElement('img');
    image.src = 'https://games.example/g/g_1/b_1/art/helm.png?sig=secret';
    document.body.append(image);
    image.dispatchEvent(new Event('error'));
    image.remove();
    expect(report).toHaveBeenCalledWith({ kind: 'asset', message: 'img https://games.example/g/g_1/b_1/art/helm.png' });
  });

  it('relays a CSP block and a WebGL context loss (neither bubbles to window)', () => {
    const report = relay();
    const csp = Object.assign(new Event('securitypolicyviolation'), {
      effectiveDirective: 'script-src',
      blockedURI: 'https://cdn.example/restore.js?v=2',
    });
    document.body.dispatchEvent(csp);
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    canvas.dispatchEvent(new Event('webglcontextlost'));
    canvas.remove();
    expect(report.mock.calls.map(([fault]) => fault)).toEqual([
      { kind: 'csp', message: 'script-src blocked https://cdn.example/restore.js' },
      { kind: 'webgl', message: 'WebGL context lost' },
    ]);
  });

  it('sends a repeating error once, so a per-frame throw cannot flood the bridge', () => {
    const report = relay();
    for (let frame = 0; frame < 100; frame += 1) {
      window.dispatchEvent(new ErrorEvent('error', { error: new Error('tick'), message: 'tick' }));
    }
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('stops listening once removed', () => {
    const report = relay();
    stop?.();
    window.dispatchEvent(
      Object.assign(new Event('securitypolicyviolation'), { effectiveDirective: 'img-src', blockedURI: 'x' }),
    );
    expect(report).not.toHaveBeenCalled();
  });
});
