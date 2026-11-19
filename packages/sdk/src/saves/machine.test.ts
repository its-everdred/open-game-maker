import type { GameInstance, SaveData } from '@ogm/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSaveMachine } from './machine.js';

type State = { value: number };

function fixture() {
  let value = 0;
  let safe = true;
  const instance = {
    serialize: vi.fn((): SaveData<State> => ({ saveSchemaVersion: 1, data: { value } })),
    canSaveNow: vi.fn(() => safe),
  } as unknown as GameInstance<unknown, State> & { canSaveNow(): boolean };
  const send = vi.fn();
  const states: string[] = [];
  const machine = createSaveMachine({ instance, send, onState: (state) => states.push(state) });
  return {
    instance,
    machine,
    send,
    states,
    setValue: (next: number) => (value = next),
    setSafe: (next: boolean) => (safe = next),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('save machine', () => {
  it.each([
    ['pause', (machine: ReturnType<typeof createSaveMachine>) => machine.pause()],
    ['checkpoint', (machine: ReturnType<typeof createSaveMachine>) => machine.checkpoint()],
    ['hidden', (machine: ReturnType<typeof createSaveMachine>) => machine.hidden()],
  ] as const)('writes a dirty save for the %s trigger', (reason, trigger) => {
    const { machine, send } = fixture();
    machine.markDirty();
    trigger(machine);

    expect(send).toHaveBeenCalledWith('save.write', expect.objectContaining({ saveSchemaVersion: 1, reason }));
    machine.dispose();
  });

  it('writes on the 30 second interval only while dirty', () => {
    vi.useFakeTimers();
    const { machine, send } = fixture();
    vi.advanceTimersByTime(30_000);
    expect(send).not.toHaveBeenCalled();
    machine.markDirty();
    vi.advanceTimersByTime(30_000);
    expect(send).toHaveBeenCalledWith('save.write', expect.objectContaining({ reason: 'interval' }));
    machine.dispose();
  });

  it('reuses the last safe snapshot when the game cannot save now', () => {
    const { machine, send, setSafe, setValue } = fixture();
    setValue(9);
    setSafe(false);
    machine.markDirty();
    machine.hidden();

    expect(send).toHaveBeenCalledWith('save.write', expect.objectContaining({ data: { value: 0 }, reason: 'hidden' }));
    machine.dispose();
  });

  it('uses the restored state as the last safe snapshot', () => {
    const { machine, send, setSafe } = fixture();
    machine.restored({ saveSchemaVersion: 1, data: { value: 42 } });
    setSafe(false);
    machine.markDirty();
    machine.hidden();
    expect(send).toHaveBeenCalledWith('save.write', expect.objectContaining({ data: { value: 42 } }));
    machine.dispose();
  });

  it('retains the screenshot of the last safe state when saving becomes unsafe', () => {
    const instance = {
      serialize: () => ({ saveSchemaVersion: 1, data: {} }),
      canSaveNow: vi.fn().mockReturnValueOnce(true).mockReturnValue(false),
    };
    const send = vi.fn();
    const captureThumbnail = vi.fn().mockReturnValue('data:image/webp;base64,YWJj');
    const machine = createSaveMachine({ instance, send, captureThumbnail });
    machine.markDirty();
    machine.checkpoint();
    machine.markDirty();
    machine.hidden();
    expect(captureThumbnail).toHaveBeenCalledOnce();
    expect(send).toHaveBeenLastCalledWith(
      'save.write',
      expect.objectContaining({ thumbnail: 'data:image/webp;base64,YWJj' }),
    );
    machine.dispose();
  });

  it('tracks local, cloud, conflict, queued, and read-only states', () => {
    const { machine, states } = fixture();
    machine.markDirty();
    machine.pause();
    machine.savedCloud();
    machine.conflict();
    machine.queued();
    machine.readOnly();

    expect(states).toEqual(['pending_local', 'saved_local', 'saved_cloud', 'conflict', 'queued', 'read_only']);
    expect(machine.state()).toBe('read_only');
    machine.dispose();
  });
});
