import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mergeShowcase } from './showcase';
import { Tile } from './Tile';

afterEach(cleanup);

it('marks a restricted coming soon game for its viewer', () => {
  const game = {
    id: 'g',
    familyId: 'f',
    ownerId: 'o',
    repo: null,
    title: 'Soon',
    createdAt: '',
    releaseState: 'coming_soon' as const,
    canPlay: false,
  };
  render(<Tile game={game} selected={false} tabIndex={0} onClick={vi.fn()} onFocus={vi.fn()} />);
  expect(screen.getByText('Coming Soon')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Soon: Coming Soon' })).toBeInTheDocument();
});

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
    const entry = mergeShowcase([]).find((game) => game.title === 'Mossy Leap')!;
    const game = { ...entry, showcase: { ...entry.showcase!, badge: 'Featured' } };
    render(<Tile game={game} selected={false} tabIndex={0} onClick={vi.fn()} onFocus={vi.fn()} />);
    expect(screen.getByText('Featured')).toBeVisible();
    expect(screen.getAllByText('Mossy Leap').length).toBeGreaterThan(0);
    expect(screen.getByText('★ 4.5')).toBeVisible();
    expect(screen.getByLabelText('Platformer, Cute, Retro')).toBeInTheDocument();
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

it('uses the genre icons on a real game tile rather than player tags', () => {
  const game = {
    id: 'g',
    familyId: 'f',
    ownerId: 'o',
    repo: null,
    title: 'Blobs',
    slug: 'blobs',
    createdAt: '',
    tags: ['Solo', 'Multiplayer', 'Cozy'],
    choices: { genre: ['puzzle'] },
  };
  render(<Tile game={game} selected={false} tabIndex={0} onClick={vi.fn()} onFocus={vi.fn()} />);
  expect(screen.getByLabelText('puzzle, Cozy')).toBeInTheDocument();
  expect(screen.queryByLabelText('Solo, Multiplayer')).toBeNull();
  cleanup();
  const unknown = { id: 'g', familyId: 'f', ownerId: 'o', repo: null, title: 'Game', createdAt: '', tags: ['Zany'] };
  const { container } = render(
    <Tile game={unknown} selected={false} tabIndex={0} onClick={vi.fn()} onFocus={vi.fn()} />,
  );
  expect(screen.getByLabelText('Zany')).toBeInTheDocument();
  expect(container.querySelector('.game-tag-icons svg')).not.toBeNull();
});

it('shows creating status and prevents opening a game before repository provisioning finishes', () => {
  const game = {
    id: 'g-creating',
    familyId: 'f',
    ownerId: 'o',
    repo: null,
    title: 'Castle Game',
    createdAt: '',
    creationStatus: 'creating' as const,
  };
  const onClick = vi.fn();
  render(<Tile game={game} selected={false} tabIndex={0} onClick={onClick} onFocus={vi.fn()} />);
  expect(screen.getByText('Creating…')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Castle Game: Creating' })).toBeDisabled();
});

it('shows retained uncertain creates as failed setup instead of a dead game tile', () => {
  const game = {
    id: 'g-uncertain',
    familyId: 'f',
    ownerId: 'o',
    repo: null,
    title: 'Castle Game',
    createdAt: '',
    creationStatus: 'failed' as const,
  };
  render(<Tile game={game} selected={false} tabIndex={0} onClick={vi.fn()} onFocus={vi.fn()} />);
  expect(screen.getByText('Setup failed')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Castle Game: Setup failed' })).toBeDisabled();
});

// #1312: a refreshed list pointed a card at a new build's logo and the card blanked until it loaded.
it('keeps a card logo on screen while a refreshed list changes it, and loads first-screen art first', () => {
  const game = { id: 'g', familyId: 'f', ownerId: 'o', repo: null, title: 'Dusk Helm', createdAt: '' };
  const props = { selected: false, tabIndex: 0, onClick: vi.fn(), onFocus: vi.fn() };
  const { container, rerender } = render(<Tile game={{ ...game, logoUrl: '/old.png' }} eager {...props} />);
  const old = container.querySelector<HTMLImageElement>('img.game-logo')!;
  expect(old).toHaveAttribute('fetchpriority', 'high');
  expect(old).toHaveAttribute('loading', 'eager');
  Object.defineProperty(old, 'naturalWidth', { configurable: true, value: 300 });
  fireEvent.load(old);

  rerender(<Tile game={{ ...game, logoUrl: '/new.png' }} eager {...props} />);
  const logos = [...container.querySelectorAll('img.game-logo')];
  expect(logos.map((img) => img.getAttribute('src'))).toEqual(['/new.png', '/old.png']);
  expect(logos[1]).toBe(old);

  rerender(<Tile game={{ ...game, logoUrl: '/new.png' }} {...props} />);
  expect(container.querySelector('img.game-logo')).toHaveAttribute('loading', 'lazy');
});
