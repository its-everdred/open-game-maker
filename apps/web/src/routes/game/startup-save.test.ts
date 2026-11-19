import { afterEach, expect, it, vi } from 'vitest';
import type { GameManifest } from '@ogm/contracts/browser';

const api = vi.hoisted(() => ({ getOptionalSaves: vi.fn(), getSave: vi.fn() }));
vi.mock('../../features/editor/api', () => api);
import { saveOptions } from './startup-save';

const manifest = { saves: true, saveSchema: 1 } as GameManifest;
afterEach(() => {
  vi.clearAllMocks();
  Reflect.deleteProperty(document, 'visibilityState');
});

it('restores an away snapshot instead of the automatic slot and keeps startup paused', async () => {
  const save = { saveSchemaVersion: 1, data: { level: 7 } };
  const hold = { current: true };
  const options = saveOptions('game', { current: undefined }, { current: false }, { buildId: 'build', save }, hold);
  await expect(options.startupRestore(manifest)).resolves.toEqual(save);
  expect(api.getOptionalSaves).not.toHaveBeenCalled();
  expect(options.resumeAfterStartup()).toBe(false);
  hold.current = false;
  expect(options.resumeAfterStartup()).toBe(true);
});

it('uses a valid auto slot for an away marker with no snapshot while staying paused', async () => {
  const save = { saveSchemaVersion: 1, data: { level: 2 } };
  api.getOptionalSaves.mockResolvedValue({ available: true, value: { slots: [{ slotId: 'auto', status: 'ok' }] } });
  api.getSave.mockResolvedValue(save);
  const options = saveOptions(
    'game',
    { current: undefined },
    { current: false },
    { buildId: 'new' },
    { current: true },
  );
  await expect(options.startupRestore(manifest)).resolves.toEqual(save);
  expect(api.getOptionalSaves).toHaveBeenCalledOnce();
  expect(options.resumeAfterStartup()).toBe(false);
});

it('keeps the hold when focus loss was observed before the menu renders', () => {
  expect(
    saveOptions('game', { current: undefined }, { current: false }, undefined, { current: true }).resumeAfterStartup(),
  ).toBe(false);
});

it('does not resume a startup held while the page is hidden', () => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  expect(saveOptions('game', { current: undefined }, { current: false }).resumeAfterStartup()).toBe(false);
});
