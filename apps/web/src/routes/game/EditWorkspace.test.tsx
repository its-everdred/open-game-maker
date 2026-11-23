import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { StreamedChatMessage } from '../../features/build-chat/stream';
import { EditWorkspace, GameEditWorkspace } from './EditWorkspace';

/* The real conversation streams from the API; the test plays its messages in directly. */
let emitMessages: ((messages: StreamedChatMessage[]) => void) | undefined;
vi.mock('./EditConversation', () => ({
  EditConversation: ({ onMessages }: { onMessages?(jobId: string, messages: StreamedChatMessage[]): void }) => {
    emitMessages = (messages) => onMessages?.('job', messages);
    return null;
  },
}));

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
  const { rerender } = render(<EditWorkspace game={<div />} chat={<div />} lastReply={0} />);
  rerender(<EditWorkspace game={<div />} chat={<div />} lastReply={1000} />);
  fireEvent.click(screen.getByRole('button', { name: 'Chat, new reply' }));
  /* A reply while the creator reads it is already seen. */
  rerender(<EditWorkspace game={<div />} chat={<div />} lastReply={2000} />);
  fireEvent.click(screen.getByRole('button', { name: 'Chat' }));
  expect(screen.getByRole('button', { name: 'Chat' })).toBeInTheDocument();
  rerender(<EditWorkspace game={<div />} chat={<div />} lastReply={3000} />);
  expect(screen.getByRole('button', { name: 'Chat, new reply' })).toBeInTheDocument();
});

it('shows no chat bubble while playing', () => {
  render(<EditWorkspace game={<div />} chat={<div />} editing={false} />);
  expect(screen.queryByRole('button', { name: 'Chat' })).toBeNull();
});

// The host draws touch buttons over the bottom-right of the game; the bubble must not cover them.
const rect = (top: number, right: number, height: number, width = 50) =>
  ({ top, bottom: top + height, right, left: right - width, width, height, x: right - width, y: top }) as DOMRect;

it('lifts the bubble above the touch controls in its column', async () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('edit-workspace-game')) return rect(0, 390, 844, 390);
    if (this.classList.contains('edit-workspace-chat-bubble')) return rect(844 - 66, 390 - 16, 50);
    if (this.dataset.action === 'jump') return rect(844 - 24 - 64, 390 - 24, 64, 64);
    if (this.dataset.action === 'use') return rect(844 - 24 - 76 - 54, 390 - 34, 44, 44);
    if (this.dataset.stick === 'move') return rect(400, 124, 100, 100);
    return rect(0, 0, 0, 0);
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

it('measures the column where the bubble really sits, so a notch inset that moves it inward still clears controls', () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('edit-workspace-game')) return rect(0, 844, 390, 844);
    /* A 60px right inset moves the bubble inward, over the second column of buttons. */
    if (this.classList.contains('edit-workspace-chat-bubble')) return rect(390 - 66, 844 - 76, 50);
    /* First column, bottom row; second column, second row (overlay.ts pitch 76, small-button inset 10). */
    if (this.dataset.action === 'jump') return rect(390 - 24 - 64, 844 - 24, 64, 64);
    if (this.dataset.action === 'use') return rect(390 - 110 - 44, 844 - 110, 44, 44);
    return rect(0, 0, 0, 0);
  });
  const { container } = render(
    <EditWorkspace
      game={
        <div>
          <button data-action="jump" />
          <button data-action="use" />
        </div>
      }
      chat={<div />}
    />,
  );
  /* The second-column button 154px up is under the inset bubble, so the bubble clears it, not just the 88px corner. */
  expect(container.querySelector<HTMLElement>('.edit-workspace')!.style.getPropertyValue('--edit-chat-rise')).toBe(
    '154px',
  );
});

// Kevin (#1295): the badge means a new agent reply, so the job's replayed history and the creator's own lines never set it.
it('counts only agent replies from after the page opened, and not a replay after returning from play', () => {
  const now = Date.now();
  const message = (id: string, actor: 'agent' | 'creator', at: number) =>
    ({ id, job_id: 'job', actor, kind: 'text', text: id, at: new Date(at).toISOString() }) as StreamedChatMessage;
  const conversation = {} as ComponentProps<typeof GameEditWorkspace>['conversation'];
  const { rerender } = render(<GameEditWorkspace game={<div />} conversation={conversation} editing />);
  const older = message('a', 'agent', now - 60_000);
  act(() => emitMessages!([older, message('b', 'creator', now + 1_000)]));
  expect(screen.getByRole('button', { name: 'Chat' })).toBeInTheDocument();

  const reply = message('c', 'agent', now + 2_000);
  act(() => emitMessages!([older, reply]));
  fireEvent.click(screen.getByRole('button', { name: 'Chat, new reply' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chat' }));

  /* Play mode unmounts the conversation; back in edit it replays from empty. */
  rerender(<GameEditWorkspace game={<div />} conversation={conversation} editing={false} />);
  rerender(<GameEditWorkspace game={<div />} conversation={conversation} editing />);
  act(() => emitMessages!([]));
  act(() => emitMessages!([older, reply]));
  expect(screen.getByRole('button', { name: 'Chat' })).toBeInTheDocument();
});
