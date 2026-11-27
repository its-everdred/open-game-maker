import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { GlassDialog } from './GlassDialog';

it('uses the shared dialog semantics and closes on Escape', () => {
  const close = vi.fn();
  render(
    <GlassDialog title="Settings" onClose={close}>
      <button>Done</button>
    </GlassDialog>,
  );
  const dialog = screen.getByRole('dialog', { name: 'Settings' });
  expect(screen.getByRole('button', { name: 'Done' })).toHaveFocus();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(close).toHaveBeenCalledOnce();
}, 30_000);

it('keeps focus in a dialog with no interactive children', () => {
  render(
    <GlassDialog title="Empty" onClose={() => undefined}>
      Nothing to change.
    </GlassDialog>,
  );
  const dialog = screen.getByRole('dialog', { name: 'Empty' });
  expect(dialog).toHaveFocus();
  const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  dialog.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(dialog).toHaveFocus();
}, 30_000);
