import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ReviewMatrix } from './ReviewMatrix';

const rows = [
  { id: 'walk', label: 'Walk', cells: [
    { optionId: 'original-walk', label: 'Original walk', media: { url: '/original-walk.png' }, original: true },
    { optionId: 'walk-v1', label: 'Walk variation 1', media: { url: '/walk-1.png' } },
    { optionId: 'walk-v2', label: 'Walk variation 2', media: { url: '/walk-2.png' } },
  ] },
  { id: 'jump', label: 'Jump', cells: [
    { optionId: 'original-jump', label: 'Original jump', media: { url: '/original-jump.png' }, original: true },
    { optionId: 'jump-v1', label: 'Jump variation 1', media: { url: '/jump-1.png' } },
    { optionId: 'jump-v2', label: 'Jump variation 2', media: { url: '/jump-2.png' } },
  ] },
];

it('renders two rows, votes inline and in the enlarged view, and records a note', () => {
  const onVote = vi.fn();
  render(<ReviewMatrix rows={rows} votes={{}} onVote={onVote} />);
  expect(screen.getAllByRole('region').length).toBeGreaterThanOrEqual(2);
  expect(screen.queryByRole('button', { name: 'Like Original walk' })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Like Walk variation 1' }));
  expect(onVote).toHaveBeenCalledWith('walk-v1', { verdict: 'like' });

  fireEvent.click(screen.getByRole('button', { name: 'Enlarge Walk variation 2' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Note for Walk variation 2' }), { target: { value: 'keep the cape' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Like Walk variation 2' })[1]!);
  expect(onVote).toHaveBeenCalledWith('walk-v2', { note: 'keep the cape' });
  expect(onVote).toHaveBeenLastCalledWith('walk-v2', { verdict: 'like', note: 'keep the cape' });
});
