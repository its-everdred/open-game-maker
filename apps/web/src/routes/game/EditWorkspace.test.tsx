import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EditWorkspace } from './EditWorkspace';

afterEach(() => vi.unstubAllGlobals());

it('keeps the game and chat visible while optional editor tools open', () => {
  const { rerender } = render(<EditWorkspace game={<div>Game</div>} chat={<div>Chat</div>} />);
  expect(screen.getByText('Game')).toBeVisible();
  expect(screen.getByText('Chat')).toBeVisible();
  expect(screen.queryByLabelText('Game editor')).toBeNull();

  rerender(<EditWorkspace game={<div>Game</div>} chat={<div>Chat</div>} editor={<button>Paint</button>} />);
  const editor = screen.getByLabelText('Game editor');
  expect(screen.getByText('Paint')).not.toBeVisible();
  fireEvent.click(editor);
  expect(screen.getByText('Paint')).toBeVisible();
  expect(screen.getByText('Game')).toBeVisible();
  expect(screen.getByText('Chat')).toBeVisible();
});

// Kevin (#1269): the edit preview follows the device; turning the phone turns the game.
it('gives the edit preview the window aspect and follows a turn of the device', () => {
  vi.stubGlobal('innerWidth', 390);
  vi.stubGlobal('innerHeight', 844);
  const { container } = render(<EditWorkspace game={<div />} chat={<div />} />);
  const workspace = container.querySelector<HTMLElement>('.edit-workspace')!;
  expect(workspace.style.getPropertyValue('--edit-frame-aspect')).toBe('390 / 844');
  vi.stubGlobal('innerWidth', 844);
  vi.stubGlobal('innerHeight', 390);
  act(() => window.dispatchEvent(new Event('resize')));
  expect(workspace.style.getPropertyValue('--edit-frame-aspect')).toBe('844 / 390');
});

it('keeps the preview shape while the phone keyboard shortens the window', () => {
  vi.stubGlobal('innerWidth', 390);
  vi.stubGlobal('innerHeight', 844);
  const { container } = render(<EditWorkspace game={<div />} chat={<textarea aria-label="Message" />} />);
  const workspace = container.querySelector<HTMLElement>('.edit-workspace')!;
  screen.getByLabelText('Message').focus();
  vi.stubGlobal('innerHeight', 500);
  act(() => window.dispatchEvent(new Event('resize')));
  expect(workspace.style.getPropertyValue('--edit-frame-aspect')).toBe('390 / 844');
  vi.stubGlobal('innerWidth', 844);
  vi.stubGlobal('innerHeight', 390);
  act(() => window.dispatchEvent(new Event('resize')));
  expect(workspace.style.getPropertyValue('--edit-frame-aspect')).toBe('844 / 390');
});

it('treats a focused field inside the chat composer shadow root as typing', () => {
  vi.stubGlobal('innerWidth', 390);
  vi.stubGlobal('innerHeight', 844);
  const host = document.createElement('div');
  const field = document.createElement('textarea');
  host.attachShadow({ mode: 'open' }).append(field);
  const { container } = render(<EditWorkspace game={<div />} chat={<div />} />);
  container.querySelector('.edit-workspace-chat')!.append(host);
  field.focus();
  vi.stubGlobal('innerHeight', 500);
  act(() => window.dispatchEvent(new Event('resize')));
  expect(container.querySelector<HTMLElement>('.edit-workspace')!.style.getPropertyValue('--edit-frame-aspect')).toBe(
    '390 / 844',
  );
});
