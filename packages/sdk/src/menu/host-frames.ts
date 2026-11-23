import type { GameManifest } from '@ogm/contracts/game';
import type { ActionFrame } from '@ogm/contracts/input';

export type ActionKinds = GameManifest['inputs']['actions'];
type Listener = (frame: ActionFrame, kinds: ActionKinds) => void;

// boot feeds host input frames here while the game is not paused.
let kinds: ActionKinds = {};
const listeners = new Set<Listener>();

export function setMenuActionKinds(next: ActionKinds): void {
  kinds = { ...next };
}

export function deliverMenuFrame(frame: ActionFrame): void {
  for (const listener of listeners) listener(frame, kinds);
}

export function onMenuFrame(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
