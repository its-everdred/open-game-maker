import type { GameManifest } from '@ogm/contracts/game';
import type { ActionFrame, ControlsLayout } from '@ogm/contracts/input';

export type ActionKinds = GameManifest['inputs']['actions'];
export type MenuBindings = { stick?: string; confirm?: string; back?: string };
type Listener = (frame: ActionFrame, kinds: ActionKinds, act: boolean, bindings?: MenuBindings) => void;

// boot feeds every host input frame here; `act` is false while the game is paused under the host's own dialog.
let kinds: ActionKinds = {};
let inputs: GameManifest['inputs'] | undefined;
let bindings: MenuBindings | undefined;
const listeners = new Set<Listener>();

export function setMenuActionKinds(next: ActionKinds): void {
  kinds = { ...next };
  inputs = undefined;
  bindings = undefined;
}

export function setMenuControlInputs(next: GameManifest['inputs']): void {
  inputs = next;
  kinds = { ...next.actions };
  setMenuControlLayout('gameplay');
}

export function setMenuControlLayout(layout: ControlsLayout): void {
  const sets = inputs?.controls;
  const set = sets && Object.hasOwn(sets, layout) ? sets[layout] : undefined;
  if (!set) {
    bindings = sets ? {} : undefined;
    return;
  }
  const confirm = set.buttons.find((button) => button.icon === 'confirm')?.action ?? set.buttons[0]?.action;
  const back = set.buttons.find((button) => button.icon === 'back')?.action;
  bindings = { stick: set.stick, confirm, back };
}

export function deliverMenuFrame(frame: ActionFrame, act = true): void {
  for (const listener of listeners) listener(frame, kinds, act, bindings);
}

export function onMenuFrame(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
