import { useHostStore } from '../../app/store';

export type Toast = { id: number; text: string };
export type NotifySlice = {
  denied: boolean;
  toasts: Toast[];
  updates: Toast[];
  unreadUpdates: number;
  updateOwner: string | undefined;
};

useHostStore.getState().registerSlice<NotifySlice>('notify', () => ({
  denied: false,
  toasts: [],
  updates: [],
  unreadUpdates: 0,
  updateOwner: undefined,
}));

const read = () => useHostStore.getState().slices.notify as NotifySlice;
const write = (patch: Partial<NotifySlice>) =>
  useHostStore.setState((s) => ({
    slices: { ...s.slices, notify: { ...(s.slices.notify as NotifySlice), ...patch } },
  }));

let nextId = 1;
export const notifyState = read;
export const useNotify = <T>(pick: (s: NotifySlice) => T) => useHostStore((s) => pick(s.slices.notify as NotifySlice));
export const setDenied = (denied: boolean) => write({ denied });
export function pushToast(text: string): void {
  write({ toasts: [...read().toasts, { id: nextId++, text }] });
}
export function dismissToast(id: number): void {
  write({ toasts: read().toasts.filter((t) => t.id !== id) });
}

// A repeated notice ("Reviews are ready" once per batch) shows once, at its latest arrival, and counts once while
// it is unread.
export function pushUpdate(text: string): void {
  const { updates, unreadUpdates } = read();
  const unreadRepeat = updates
    .slice(Math.max(0, updates.length - unreadUpdates))
    .some((update) => update.text === text);
  write({
    updates: [...updates.filter((update) => update.text !== text), { id: nextId++, text }].slice(-100),
    unreadUpdates: unreadRepeat ? unreadUpdates : unreadUpdates + 1,
  });
}
export function readUpdates(): void {
  write({ unreadUpdates: 0 });
}

export function setUpdateOwner(owner: string | undefined): void {
  if (read().updateOwner !== owner) write({ updateOwner: owner, updates: [], unreadUpdates: 0 });
}
