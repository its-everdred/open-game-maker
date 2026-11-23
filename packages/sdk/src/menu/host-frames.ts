import type { GameManifest } from '@ogm/contracts/game';
import type { ActionFrame } from '@ogm/contracts/input';

export type ActionKinds = GameManifest['inputs']['actions'];
type Listener = (frame: ActionFrame, kinds: ActionKinds, act: boolean) => void;

// boot feeds every host input frame here; `act` is false while the game is paused under the host's own dialog.
let kinds: ActionKinds = {};
const listeners = new Set<Listener>();

export function setMenuActionKinds(next: ActionKinds): void {
  kinds = { ...next };
}

export function deliverMenuFrame(frame: ActionFrame, act = true): void {
  for (const listener of listeners) listener(frame, kinds, act);
}

export function onMenuFrame(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
