import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { EditWorkspace } from './EditWorkspace';

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
