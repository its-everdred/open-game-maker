import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mergeShowcase } from './showcase';
import { Tile } from './Tile';

afterEach(cleanup);

describe('showcase tile', () => {
  it('replaces the title with a declared logo while retaining the accessible name', () => {
    const game = { ...mergeShowcase([])[0]!, logoUrl: '/logo.png' };
    const { container } = render(
      <Tile game={game} selected={false} tabIndex={0} onClick={vi.fn()} onFocus={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: new RegExp(game.title) })).toBeInTheDocument();
    expect(container.querySelector('img[src="/logo.png"]')).toBeInTheDocument();
    expect(screen.queryByText(game.title)).not.toBeInTheDocument();
  });

  it('shows the featured badge, title, icons and rating from the prototype', () => {
    const game = mergeShowcase([]).find((entry) => entry.title === 'RestoreBound')!;
    render(<Tile game={game} selected={false} tabIndex={0} onClick={vi.fn()} onFocus={vi.fn()} />);
    expect(screen.getByText('Featured')).toBeVisible();
    expect(screen.getAllByText('RestoreBound').length).toBeGreaterThan(0);
    expect(screen.getByText('★ 4.7')).toBeVisible();
    expect(screen.getByLabelText('Adventure, Craft, Cozy, Calm')).toBeInTheDocument();
  });
});

it('does not repeat the text title in the placeholder behind a logo', () => {
  const game = {
    id: 'g',
    familyId: 'f',
    ownerId: 'o',
    repo: null,
    title: 'Blobs',
    createdAt: '',
    logoUrl: '/logo.png',
  };
  render(<Tile game={game} selected={false} tabIndex={0} onClick={vi.fn()} onFocus={vi.fn()} />);
  expect(screen.queryByText('Blobs')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Blobs' })).toBeInTheDocument();
});
