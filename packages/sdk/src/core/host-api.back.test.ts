import { expect, it, vi } from 'vitest';
import { SdkHostApi } from './host-api.js';

it('declares Back and only dispatches while enabled', () => {
  const send = vi.fn();
  const host = new SdkHostApi(send, () => undefined);
  const action = vi.fn();
  const off = host.back.on(action);
  host.dispatchBack();
  expect(action).not.toHaveBeenCalled();
  host.back.set({ enabled: true, label: 'Choose mode' });
  expect(send).toHaveBeenCalledWith('host.back', { enabled: true, label: 'Choose mode' });
  host.dispatchBack();
  expect(action).toHaveBeenCalledOnce();
  host.back.set({ enabled: false });
  host.dispatchBack();
  expect(action).toHaveBeenCalledOnce();
  off();
  host.back.set({ enabled: true });
  host.dispatchBack();
  expect(action).toHaveBeenCalledOnce();
});

it('does not invoke a replacement handler during the same Back action', () => {
  const host = new SdkHostApi(
    () => undefined,
    () => undefined,
  );
  const next = vi.fn();
  const off = host.back.on(() => {
    off();
    host.back.on(next);
  });
  host.back.set({ enabled: true });
  host.dispatchBack();
  expect(next).not.toHaveBeenCalled();
  host.dispatchBack();
  expect(next).toHaveBeenCalledOnce();
});
