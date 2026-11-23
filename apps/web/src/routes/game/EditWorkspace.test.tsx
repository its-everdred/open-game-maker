import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EditWorkspace } from './EditWorkspace';

afterEach(() => vi.restoreAllMocks());

it('keeps the game visible while optional editor tools open', () => {
  const { rerender } = render(<EditWorkspace game={<div>Game</div>} chat={<div>Chat</div>} />);
  expect(screen.getByText('Game')).toBeVisible();
  expect(screen.queryByLabelText('Game editor')).toBeNull();

  rerender(<EditWorkspace game={<div>Game</div>} chat={<div>Chat</div>} editor={<button>Paint</button>} />);
  const editor = screen.getByLabelText('Game editor');
  expect(screen.getByText('Paint')).not.toBeVisible();
  fireEvent.click(editor);
  expect(screen.getByText('Paint')).toBeVisible();
  expect(screen.getByText('Game')).toBeVisible();
});

// Kevin (#1295): the chat hides behind a bottom-right bubble, closed by default, so the game gets the whole page.
it('starts with the chat closed behind its bubble and toggles it with the same button', () => {
  render(<EditWorkspace game={<div>Game</div>} chat={<div>Chat</div>} />);
  const bubble = screen.getByRole('button', { name: 'Chat' });
  expect(bubble).toHaveAttribute('aria-expanded', 'false');
  expect(bubble).not.toHaveTextContent(/\w/);
  expect(screen.getByText('Chat', { selector: 'div' })).not.toBeVisible();

  fireEvent.click(bubble);
  expect(bubble).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText('Chat', { selector: 'div' })).toBeVisible();

  fireEvent.click(bubble);
  expect(screen.getByText('Chat', { selector: 'div' })).not.toBeVisible();
});

it('closes the chat on a swipe down its handle, not on a short drag', () => {
  const { container } = render(<EditWorkspace game={<div />} chat={<div>Chat</div>} />);
  fireEvent.click(screen.getByRole('button', { name: 'Chat' }));
  const handle = container.querySelector('.edit-workspace-chat-handle')!;
  fireEvent.pointerDown(handle, { clientY: 300 });
  fireEvent.pointerUp(handle, { clientY: 320 });
  expect(screen.getByText('Chat')).toBeVisible();
  fireEvent.pointerDown(handle, { clientY: 300 });
  fireEvent.pointerUp(handle, { clientY: 380 });
  expect(screen.getByText('Chat')).not.toBeVisible();
});

it('keeps the conversation mounted while closed, so a draft survives', () => {
  render(<EditWorkspace game={<div />} chat={<textarea aria-label="Message" />} />);
  const bubble = screen.getByRole('button', { name: 'Chat' });
  fireEvent.click(bubble);
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Make the goblins faster' } });
  fireEvent.click(bubble);
  fireEvent.click(bubble);
  expect(screen.getByLabelText('Message')).toHaveValue('Make the goblins faster');
});

it('marks the bubble unread when the agent replies while the chat is closed, and clears it on open', () => {
  const { rerender } = render(<EditWorkspace game={<div />} chat={<div />} replies={0} />);
  rerender(<EditWorkspace game={<div />} chat={<div />} replies={1} />);
  const bubble = screen.getByRole('button', { name: 'Chat, new reply' });
  fireEvent.click(bubble);
  expect(screen.getByRole('button', { name: 'Chat' })).toBeInTheDocument();
  rerender(<EditWorkspace game={<div />} chat={<div />} replies={2} />);
  expect(screen.getByRole('button', { name: 'Chat' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Chat' }));
  expect(screen.getByRole('button', { name: 'Chat' })).toBeInTheDocument();
});

it('shows no chat bubble while playing', () => {
  render(<EditWorkspace game={<div />} chat={<div />} editing={false} />);
  expect(screen.queryByRole('button', { name: 'Chat' })).toBeNull();
});

// The host draws touch buttons over the bottom-right of the game; the bubble must not cover them.
it('lifts the bubble above the touch controls in its column', async () => {
  const rect = (top: number, right: number, height: number) =>
    ({ top, bottom: top + height, right, left: right - 50, width: 50, height, x: right - 50, y: top }) as DOMRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('edit-workspace-game')) return rect(0, 390, 844);
    if (this.dataset.action === 'jump') return rect(844 - 24 - 64, 390 - 24, 64);
    if (this.dataset.action === 'use') return rect(844 - 24 - 76 - 54, 390 - 34, 44);
    if (this.dataset.stick === 'move') return rect(400, 124, 100);
    return rect(0, 0, 0);
  });
  const { container, rerender } = render(<EditWorkspace game={<div />} chat={<div />} />);
  const workspace = container.querySelector<HTMLElement>('.edit-workspace')!;
  expect(workspace.style.getPropertyValue('--edit-chat-rise')).toBe('0px');

  rerender(
    <EditWorkspace
      game={
        <div>
          <div data-stick="move" />
          <button data-action="jump" />
          <button data-action="use" />
        </div>
      }
      chat={<div />}
    />,
  );
  await act(async () => {});
  /* The highest button in the bubble's column ends 154px up; the stick on the left doesn't count. */
  expect(workspace.style.getPropertyValue('--edit-chat-rise')).toBe('154px');
});
