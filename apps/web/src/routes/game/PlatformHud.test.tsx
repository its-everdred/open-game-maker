import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';

import type { SaveSlot } from '@ogm/contracts/browser';

import type { GameFrameController } from '../../features/editor/frame';
import { PlatformHud } from './PlatformHud';

function frameHarness() {
  let saveWrite: ((payload: { saveSchemaVersion: number; data: unknown }) => void) | undefined;
  let event: ((kind: 'achievement' | 'analytics' | 'checkpoint', payload: unknown) => void) | undefined;
  let saveLoadError: ((message: string) => void) | undefined;
  const frame = {
    onEvent: vi.fn((callback) => {
      event = callback;
      return vi.fn();
    }),
    onSaveLoadError: vi.fn((callback) => {
      saveLoadError = callback;
      return vi.fn();
    }),
    onSaveWrite: vi.fn((callback) => {
      saveWrite = callback;
      return vi.fn();
    }),
    pause: vi.fn(),
    restoreSave: vi.fn(async (save) => save),
    confirmSaveRecovery: vi.fn(),
    resume: vi.fn(),
    setSettings: vi.fn(),
  } as unknown as GameFrameController;
  return {
    event: (kind: 'achievement' | 'analytics' | 'checkpoint', payload: unknown) => event?.(kind, payload),
    frame,
    saveLoadError: (message: string) => saveLoadError?.(message),
    saveWrite: (payload: { saveSchemaVersion: number; data: unknown }) => saveWrite?.(payload),
  };
}

const saveContext = { branch: 'main', buildId: 'build_01BX5ZZKBKACTAV9WEVGEMMVRZ' };

/** Saves and credits live in Settings, not on the pause panel itself. */
async function openSettingsSection(name: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  fireEvent.click(await screen.findByText(name));
}

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

describe('PlatformHud', () => {
  it('shows the pauser and holds the game during the resume countdown', () => {
    const test = frameHarness();
    const view = render(
      <MemoryRouter>
        <PlatformHud
          build="draft"
          frame={test.frame}
          gameId="game"
          open
          paused
          pauseName="Sam"
          resumeAt={Date.now() + 3000}
          saveContext={saveContext}
          saves={false}
          onResume={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('Paused by Sam')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeDisabled();
    expect(test.frame.pause).toHaveBeenCalledOnce();
    view.unmount();
    expect(test.frame.resume).toHaveBeenCalledOnce();
  });
  it('shows settings during live room play and persists game switches', async () => {
    localStorage.clear();
    const test = frameHarness();
    const options = [{ id: 'hints', label: 'Hints', kind: 'toggle' as const, default: true }];
    const view = render(
      <MemoryRouter>
        <PlatformHud
          build="draft"
          frame={test.frame}
          gameId="game"
          open
          paused={false}
          saveContext={saveContext}
          saves={false}
          gameOptions={options}
          onResume={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(test.frame.pause).not.toHaveBeenCalled();
    expect(test.frame.setSettings).toHaveBeenCalledWith(expect.objectContaining({ gameOptions: { hints: true } }));
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByText('Game options'));
    fireEvent.click(screen.getByLabelText('Hints'));
    await waitFor(() =>
      expect(test.frame.setSettings).toHaveBeenLastCalledWith(
        expect.objectContaining({ gameOptions: { hints: false } }),
      ),
    );
    view.unmount();
    const next = frameHarness();
    render(
      <MemoryRouter>
        <PlatformHud
          build="draft"
          frame={next.frame}
          gameId="game"
          paused={false}
          saveContext={saveContext}
          saves={false}
          gameOptions={options}
          onResume={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(next.frame.setSettings).toHaveBeenCalledWith(expect.objectContaining({ gameOptions: { hints: false } }));
    localStorage.clear();
  });

  it('persists game keyboard bindings and restores the declared defaults', async () => {
    localStorage.clear();
    const test = frameHarness();
    const defaults = { Space: 'jump' };
    render(
      <MemoryRouter>
        <PlatformHud
          build="draft"
          frame={test.frame}
          gameId="game"
          paused
          saveContext={saveContext}
          saves={false}
          controlBindings={defaults}
          onResume={vi.fn()}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByText('Controls'));
    fireEvent.click(screen.getByRole('button', { name: 'jump: Space' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'jump: press a key' }), { code: 'KeyJ' });
    await waitFor(() =>
      expect(test.frame.setSettings).toHaveBeenLastCalledWith(
        expect.objectContaining({ keyboardBindings: { KeyJ: 'jump' } }),
      ),
    );
    expect(JSON.parse(localStorage.getItem('ogm.controls.game')!)).toEqual({ KeyJ: 'jump' });
    fireEvent.click(screen.getByRole('button', { name: 'Reset controls' }));
    await waitFor(() =>
      expect(test.frame.setSettings).toHaveBeenLastCalledWith(expect.objectContaining({ keyboardBindings: defaults })),
    );
    expect(localStorage.getItem('ogm.controls.game')).toBeNull();
    localStorage.clear();
  });

  it('renders no separate Pause control while the game menu is closed', () => {
    const test = frameHarness();
    render(
      <PlatformHud
        build="draft"
        frame={test.frame}
        gameId="game"
        paused={false}
        saveContext={saveContext}
        saves={false}
        onResume={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Paused' })).not.toBeInTheDocument();
  });

  it('pauses and resumes once as the game menu opens and closes', async () => {
    const test = frameHarness();
    const onResume = vi.fn();
    const view = render(
      <PlatformHud
        build="draft"
        frame={test.frame}
        gameId="game"
        paused={false}
        saveContext={saveContext}
        saves={false}
        onResume={onResume}
      />,
    );

    view.rerender(
      <PlatformHud
        build="draft"
        frame={test.frame}
        gameId="game"
        paused
        saveContext={saveContext}
        saves={false}
        onResume={onResume}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Paused' })).toBeVisible();
    expect(screen.getByRole('dialog', { name: 'Paused' }).closest('[data-gm-overlay-allowed]')).not.toBeNull();
    expect(test.frame.pause).toHaveBeenCalledOnce();
    const resume = screen.getByRole('button', { name: 'Resume' });
    await waitFor(() => expect(resume).toHaveFocus());
    fireEvent.click(resume);

    await waitFor(() => expect(onResume).toHaveBeenCalledOnce());
    view.rerender(
      <PlatformHud
        build="draft"
        frame={test.frame}
        gameId="game"
        paused={false}
        saveContext={saveContext}
        saves={false}
        onResume={onResume}
      />,
    );
    expect(test.frame.resume).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog', { name: 'Paused' })).not.toBeInTheDocument();
  });

  it('keeps a replacement game frame paused while the menu remains open', () => {
    const first = frameHarness();
    const replacement = frameHarness();
    const view = render(
      <PlatformHud
        build="draft"
        frame={first.frame}
        gameId="game"
        paused
        saveContext={saveContext}
        saves={false}
        onResume={vi.fn()}
      />,
    );

    expect(first.frame.pause).toHaveBeenCalledOnce();
    view.rerender(
      <PlatformHud
        build="draft"
        frame={replacement.frame}
        gameId="game"
        paused
        saveContext={saveContext}
        saves={false}
        onResume={vi.fn()}
      />,
    );

    expect(first.frame.resume).toHaveBeenCalledOnce();
    expect(replacement.frame.pause).toHaveBeenCalledOnce();
    view.unmount();
    expect(replacement.frame.resume).toHaveBeenCalledOnce();
  });

  it('leaves through the screen-owned navigation action', () => {
    const test = frameHarness();
    const onLeave = vi.fn();
    render(
      <PlatformHud
        build="draft"
        frame={test.frame}
        gameId="game"
        paused
        saveContext={saveContext}
        saves={false}
        onResume={vi.fn()}
        onLeave={onLeave}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));

    expect(onLeave).toHaveBeenCalledOnce();
  });

  it('hides save controls when the later-owned route is unavailable', async () => {
    const test = frameHarness();
    const list = vi.fn().mockResolvedValue({ available: false });
    render(
      <PlatformHud
        build="draft"
        frame={test.frame}
        gameId="game"
        paused
        saveContext={saveContext}
        saves
        saveApi={{ list, read: vi.fn(), write: vi.fn() }}
        onResume={vi.fn()}
      />,
    );
    await waitFor(() => expect(list).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(screen.queryByText('Saves')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Save slots' })).not.toBeInTheDocument();
  });

  it('keeps manual slots hidden when the game did not declare them', async () => {
    const test = frameHarness();
    const list = vi.fn().mockResolvedValue({ available: true, value: { slots: [] } });
    render(
      <PlatformHud
        build="draft"
        frame={test.frame}
        gameId="game"
        paused
        saveContext={saveContext}
        saves
        saveApi={{ list, read: vi.fn(), write: vi.fn() }}
        onResume={vi.fn()}
      />,
    );
    await waitFor(() => expect(list).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.queryByText('Saves')).not.toBeInTheDocument();
  });

  it('keeps manual loads available but prevents writes after startup restore fails', async () => {
    const test = frameHarness();
    const write = vi.fn();
    const list = vi
      .fn()
      .mockResolvedValue({ available: true, value: { slots: [{ slotId: 'auto', headRevision: 1, status: 'ok' }] } });
    render(
      <PlatformHud
        build="draft"
        frame={test.frame}
        gameId="game"
        paused
        saveContext={saveContext}
        saves
        manualSaveSlots
        saveWritesDisabled
        saveApi={{ list, read: vi.fn(), write }}
        onResume={vi.fn()}
      />,
    );
    await openSettingsSection('Saves');
    expect(await screen.findByRole('button', { name: 'Load' })).toBeEnabled();
    await act(async () => {
      test.saveWrite({ saveSchemaVersion: 1, data: {} });
      await Promise.resolve();
    });
    expect(write).not.toHaveBeenCalled();
  });
  it('does not offer unconfirmed manual recovery on an older game build', async () => {
    const test = frameHarness();
    const list = vi
      .fn()
      .mockResolvedValue({ available: true, value: { slots: [{ slotId: 'auto', headRevision: 1, status: 'ok' }] } });
    render(
      <PlatformHud
        build="draft"
        frame={test.frame}
        gameId="game"
        paused
        saveContext={saveContext}
        saves
        manualSaveSlots
        saveWritesDisabled
        manualLoadDisabled
        saveApi={{ list, read: vi.fn(), write: vi.fn() }}
        onResume={vi.fn()}
      />,
    );
    await openSettingsSection('Saves');
    expect(await screen.findByRole('button', { name: 'Update game to load' })).toBeDisabled();
  });

  // A slot the running build cannot read must not offer Load: the SDK would refuse the restore and the host used to
  // swap the game for the Try again screen.
  it('offers Load only for a slot this build reads or migrates', async () => {
    const test = frameHarness();
    const slots = [
      { slotId: 'auto', headRevision: 3, status: 'ok' },
      { slotId: '1', headRevision: 4, status: 'needs_migration' },
      { slotId: '2', headRevision: 5, status: 'unsupported_old' },
      { slotId: '3', headRevision: 6, status: 'incompatible_after_rollback' },
    ] as SaveSlot[];
    const read = vi.fn();
    render(
      <PlatformHud
        build="draft"
        frame={test.frame}
        gameId="game"
        paused
        saveContext={saveContext}
        saves
        manualSaveSlots
        saveApi={{ list: vi.fn().mockResolvedValue({ available: true, value: { slots } }), read, write: vi.fn() }}
        onResume={vi.fn()}
      />,
    );
    await openSettingsSection('Saves');
    const load = await screen.findByRole('button', { name: 'Load' });

    expect(load).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save slot 1' }));
    expect(load).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save slot 2' }));
    expect(load).toBeDisabled();
    fireEvent.click(load);
    expect(read).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save slot 3' }));
    expect(load).toBeDisabled();
  });

  it('sends the running build save facts on the list request', async () => {
    const test = frameHarness();
    const list = vi.fn().mockResolvedValue({ available: true, value: { slots: [] } });
    render(
      <PlatformHud
        build="draft"
        frame={test.frame}
        gameId="game"
        paused={false}
        saveContext={saveContext}
        saves
        saveSchema={3}
        migratesFrom={2}
        saveApi={{ list, read: vi.fn(), write: vi.fn() }}
        onResume={vi.fn()}
      />,
    );

    await waitFor(() => expect(list).toHaveBeenCalledWith('game', { schema: 3, migratesFrom: 2 }));
  });

  it('lists without facts when the build reported no save schema', async () => {
    const test = frameHarness();
    const list = vi.fn().mockResolvedValue({ available: true, value: { slots: [] } });
    render(
      <PlatformHud
        build="draft"
        frame={test.frame}
        gameId="game"
        paused={false}
        saveContext={saveContext}
        saves
        saveApi={{ list, read: vi.fn(), write: vi.fn() }}
        onResume={vi.fn()}
      />,
    );

    await waitFor(() => expect(list).toHaveBeenCalledWith('game', undefined));
  });

  it('reports a save the build refused as a failed load while the game keeps running', async () => {
    const test = frameHarness();
    const toast = vi.fn();
    const slots = [{ slotId: 'auto', headRevision: 2, status: 'ok' }] as SaveSlot[];
    const save = { saveSchemaVersion: 4, data: { room: 'crypt' } };
    const saveApi = {
      list: vi.fn().mockResolvedValue({ available: true, value: { slots } }),
      read: vi.fn().mockResolvedValue(save),
      write: vi.fn(),
    };
    const onResume = vi.fn();
    render(
      <PlatformHud
        build="draft"
        frame={test.frame}
        gameId="game"
        paused
        saveContext={saveContext}
        saves
        manualSaveSlots
        saveApi={saveApi}
        toast={toast}
        onResume={onResume}
      />,
    );
    await openSettingsSection('Saves');
    fireEvent.click(await screen.findByRole('button', { name: 'Load' }));

    await waitFor(() => expect(test.frame.restoreSave).toHaveBeenCalledWith(save));
    expect(onResume).toHaveBeenCalledOnce();
    expect(toast).not.toHaveBeenCalledWith('Load failed');

    test.saveLoadError('save version is not supported');
    expect(toast).toHaveBeenCalledWith('Load failed');
  });

  it('renders all contract slots and writes game saves into the selected host slot', async () => {
    const test = frameHarness();
    const slots = [
      {
        slotId: 'auto',
        headRevision: 4,
        savedAt: '2026-11-01T16:00:00.000Z',
        thumbnail: 'data:image/webp;base64,YWJj',
      },
    ] as SaveSlot[];
    const write = vi.fn().mockResolvedValue(undefined);
    render(
      <PlatformHud
        build="draft"
        frame={test.frame}
        gameId="game"
        paused
        saveContext={saveContext}
        saves
        manualSaveSlots
        saveApi={{ list: vi.fn().mockResolvedValue({ available: true, value: { slots } }), read: vi.fn(), write }}
        onResume={vi.fn()}
      />,
    );

    await openSettingsSection('Saves');
    expect(await screen.findByRole('button', { name: /Auto save/ })).toBeVisible();
    expect(document.querySelector('time')).toHaveAttribute('datetime', '2026-11-01T16:00:00.000Z');
    expect(screen.getByRole('button', { name: /Auto save/ }).querySelector('img')).toHaveAttribute(
      'src',
      'data:image/webp;base64,YWJj',
    );
    expect(screen.getByRole('button', { name: 'Save slot 1' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save slot 2' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save slot 3' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Save slot 3' }));
    test.saveWrite({ saveSchemaVersion: 1, data: { checkpoint: 2 } });

    await waitFor(() => expect(write).toHaveBeenCalledWith('game', 'auto', expect.anything(), 4, saveContext));
    await waitFor(() =>
      expect(write).toHaveBeenCalledWith(
        'game',
        '3',
        { saveSchemaVersion: 1, data: { checkpoint: 2 } },
        undefined,
        saveContext,
      ),
    );
  });

  it('writes to the slot selected when the save event arrived', async () => {
    const test = frameHarness();
    let finishAuto!: () => void;
    const write = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishAuto = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const list = vi.fn().mockResolvedValue({ available: true, value: { slots: [] } });
    render(
      <PlatformHud
        build="draft"
        frame={test.frame}
        gameId="game"
        paused
        saveContext={saveContext}
        saves
        manualSaveSlots
        saveApi={{ list, read: vi.fn(), write }}
        onResume={vi.fn()}
      />,
    );
    await openSettingsSection('Saves');
    fireEvent.click(await screen.findByRole('button', { name: 'Save slot 1' }));
    await waitFor(() => expect(test.frame.onSaveWrite).toHaveBeenCalledOnce());
    test.saveWrite({ saveSchemaVersion: 1, data: { checkpoint: 1 } });
    await waitFor(() => expect(write).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Save slot 2' }));
    finishAuto();
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(write.mock.calls[1]?.[1]).toBe('1');
  });

  it('persists the confirmed manual restore to auto before resuming', async () => {
    const test = frameHarness();
    const old = { saveSchemaVersion: 1, data: { checkpoint: 'old' } };
    const loaded = { saveSchemaVersion: 1, data: { checkpoint: 'loaded' } };
    let finishOld!: () => void;
    const write = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishOld = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const slots = [
      { slotId: 'auto', headRevision: 1, status: 'ok' },
      { slotId: '1', headRevision: 1, status: 'ok' },
    ] as SaveSlot[];
    let finishList!: (result: { available: true; value: { slots: SaveSlot[] } }) => void;
    const list = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishList = resolve;
          }),
      )
      .mockResolvedValue({ available: true, value: { slots } });
    const read = vi.fn().mockResolvedValue(loaded);
    const onResume = vi.fn();
    const setCloseLocked = vi.fn();
    let finishRestore!: (save: typeof loaded) => void;
    vi.mocked(test.frame.restoreSave).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRestore = resolve;
        }),
    );
    render(
      <PlatformHud
        build="draft"
        frame={test.frame}
        gameId="game"
        paused
        saveContext={saveContext}
        saves
        manualSaveSlots
        setCloseLocked={setCloseLocked}
        saveApi={{ list, read, write }}
        onResume={onResume}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(test.frame.onSaveWrite).not.toHaveBeenCalled();
    await act(async () => finishList({ available: true, value: { slots } }));
    fireEvent.click(await screen.findByText('Saves'));
    await waitFor(() => expect(test.frame.onSaveWrite).toHaveBeenCalledOnce());
    test.saveWrite(old);
    await waitFor(() => expect(write).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: /Save slot 1/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    expect(setCloseLocked).toHaveBeenCalledWith(true);
    expect(screen.getByRole('button', { name: 'Save slot 2' })).toBeDisabled();
    expect(read).not.toHaveBeenCalled();
    finishOld();
    await waitFor(() => expect(test.frame.restoreSave).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Save slot 2' }));
    test.saveWrite(loaded);
    finishRestore(loaded);
    await waitFor(() => expect(onResume).toHaveBeenCalledOnce());
    expect(setCloseLocked).toHaveBeenLastCalledWith(false);
    await waitFor(() => expect(write.mock.calls.filter((call) => call[1] === 'auto').at(-1)?.[2]).toEqual(loaded));
    await waitFor(() => expect(write.mock.calls.some((call) => call[1] === '1')).toBe(true));
    expect(write.mock.calls.some((call) => call[1] === '2')).toBe(false);
  });

  it('keeps recovery protected when saving the restored state fails', async () => {
    const test = frameHarness();
    const slot = { slotId: 'auto', headRevision: 1, status: 'ok' } as SaveSlot;
    const onResume = vi.fn();
    const toast = vi.fn();
    const save = { saveSchemaVersion: 1, data: { checkpoint: 1 } };
    render(
      <PlatformHud
        build="draft"
        frame={test.frame}
        gameId="game"
        paused
        saveContext={saveContext}
        saves
        manualSaveSlots
        saveWritesDisabled
        saveApi={{
          list: vi.fn().mockResolvedValue({ available: true, value: { slots: [slot] } }),
          read: vi.fn().mockResolvedValue(save),
          write: vi.fn().mockRejectedValue(new Error('offline')),
        }}
        onResume={onResume}
        toast={toast}
      />,
    );
    await openSettingsSection('Saves');
    fireEvent.click(await screen.findByRole('button', { name: 'Load' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Load failed'));
    expect(test.frame.confirmSaveRecovery).not.toHaveBeenCalled();
    expect(onResume).not.toHaveBeenCalled();
  });

  it('refreshes the slot revision before a second save write', async () => {
    const test = frameHarness();
    const write = vi.fn().mockResolvedValue(undefined);
    const list = vi
      .fn()
      .mockResolvedValueOnce({ available: true, value: { slots: [{ slotId: 'auto', headRevision: 4 }] } })
      .mockResolvedValueOnce({ available: true, value: { slots: [{ slotId: 'auto', headRevision: 5 }] } })
      .mockResolvedValueOnce({ available: true, value: { slots: [{ slotId: 'auto', headRevision: 6 }] } });
    render(
      <PlatformHud
        build="draft"
        frame={test.frame}
        gameId="game"
        paused={false}
        saveContext={saveContext}
        saves
        saveApi={{ list, read: vi.fn(), write }}
        onResume={vi.fn()}
      />,
    );
    await waitFor(() => expect(list).toHaveBeenCalledOnce());
    await waitFor(() => expect(test.frame.onSaveWrite).toHaveBeenCalledTimes(1));

    test.saveWrite({ saveSchemaVersion: 1, data: { checkpoint: 1 } });
    await waitFor(() => expect(write).toHaveBeenNthCalledWith(1, 'game', 'auto', expect.anything(), 4, saveContext));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    test.saveWrite({ saveSchemaVersion: 1, data: { checkpoint: 2 } });

    await waitFor(() => expect(write).toHaveBeenNthCalledWith(2, 'game', 'auto', expect.anything(), 5, saveContext));
  });

  it('rereads slot heads after a failed write so a save that landed does not wedge later saves', async () => {
    const test = frameHarness();
    const toast = vi.fn();
    const write = vi.fn().mockRejectedValueOnce(new TypeError('connection reset')).mockResolvedValue(undefined);
    const list = vi
      .fn()
      .mockResolvedValueOnce({ available: true, value: { slots: [{ slotId: 'auto', headRevision: 4 }] } })
      .mockResolvedValue({ available: true, value: { slots: [{ slotId: 'auto', headRevision: 5 }] } });
    render(
      <PlatformHud
        build="draft"
        frame={test.frame}
        gameId="game"
        paused={false}
        saveContext={saveContext}
        saves
        saveApi={{ list, read: vi.fn(), write }}
        toast={toast}
        onResume={vi.fn()}
      />,
    );
    await waitFor(() => expect(list).toHaveBeenCalledOnce());
    await waitFor(() => expect(test.frame.onSaveWrite).toHaveBeenCalledTimes(1));

    test.saveWrite({ saveSchemaVersion: 1, data: { checkpoint: 1 } });
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Save failed'));
    test.saveWrite({ saveSchemaVersion: 1, data: { checkpoint: 2 } });

    await waitFor(() => expect(write).toHaveBeenNthCalledWith(2, 'game', 'auto', expect.anything(), 5, saveContext));
  });

  it('forwards safe settings and emits draft-only achievement copy', () => {
    const test = frameHarness();
    const toast = vi.fn();
    render(
      <PlatformHud
        build="draft"
        frame={test.frame}
        gameId="game"
        paused={false}
        saveContext={saveContext}
        saves={false}
        toast={toast}
        onResume={vi.fn()}
      />,
    );

    expect(test.frame.setSettings).toHaveBeenCalledWith({
      mute: false,
      volume: 1,
      musicVolume: 1,
      haptics: true,
      textScale: 1,
      reduceMotion: expect.any(Boolean),
    });
    test.event('achievement', { title: 'Opened the crypt' });
    expect(toast).toHaveBeenCalledWith('Opened the crypt (test)');
  });

  it('shows exact-build credits from pause settings, including private packs without a download action', async () => {
    const test = frameHarness();
    const credits = vi.fn().mockResolvedValue({
      version: 1,
      packs: [
        {
          pack: 'synty',
          title: 'Synty Pack',
          license: 'LicenseRef-synty-personal',
          licenseSource: 'Synty licence',
          attribution: 'none required',
          source: { label: 'Synty', url: 'https://example.test/synty' },
          private: true,
        },
      ],
    });
    render(
      <PlatformHud
        build="draft"
        frame={test.frame}
        gameId="game"
        paused
        saveContext={saveContext}
        saves={false}
        creditsApi={credits}
        onResume={vi.fn()}
      />,
    );

    await openSettingsSection('Credits');

    expect(await screen.findByText('Synty Pack')).toBeVisible();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Back' })).toHaveFocus());
    expect(credits).toHaveBeenCalledWith('game', saveContext.buildId);
    expect(screen.queryByRole('button', { name: /download/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /download/i })).not.toBeInTheDocument();
  });
});
