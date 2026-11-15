import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Spotlight } from './Spotlight';
import type { GameSummary } from './types';

vi.mock('../../features/commands-inbox/CommandsInbox', () => ({ CommandsInbox: () => null }));
afterEach(cleanup);

it('shows a logo and genre icon without a preference switch or branch pill', () => {
  const game: GameSummary = {
    id: 'g',
    familyId: 'f',
    ownerId: 'o',
    repo: null,
    title: 'Blobs',
    createdAt: '',
    logoUrl: '/logo.png',
    choices: { genre: ['Puzzle'] },
  };
  const { container } = render(
    <Spotlight game={game} branches={[]} onPlay={vi.fn()} onEdit={vi.fn()} onClose={vi.fn()} />,
  );
  expect(container.querySelector('img[src="/logo.png"]')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Blobs' })).not.toBeInTheDocument();
  expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  expect(screen.queryByText('AI-generated assets')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Puzzle').querySelector('svg')).toBeInTheDocument();
});

it('shows the puzzle icon for Blobs builds that predate genre metadata', () => {
  const game: GameSummary = {
    id: 'g',
    slug: 'blobs',
    familyId: 'f',
    ownerId: 'o',
    repo: null,
    title: 'Blobs',
    createdAt: '',
  };
  render(<Spotlight game={game} branches={[]} onPlay={vi.fn()} onEdit={vi.fn()} onClose={vi.fn()} />);
  expect(screen.getByLabelText('puzzle').querySelector('svg')).toBeInTheDocument();
});
