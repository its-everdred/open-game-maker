import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detailOf, GameDetail } from './GameDetail';
import { GameTrailer } from './GameTrailer';
import { mergeShowcase } from './showcase';
import { splatMask } from './splatMask';
import type { GameSummary } from './types';

vi.mock('../../features/commands-inbox/CommandsInbox', () => ({ CommandsInbox: () => null }));
vi.mock('./splatMask', () => ({ splatMask: vi.fn(async (seed: string) => `data:image/png;base64,${seed}`) }));

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

const blobs: GameSummary = {
  id: 'g-blobs',
  slug: 'blobs',
  familyId: 'f',
  ownerId: 'o',
  repo: null,
  title: 'Blobs',
  createdAt: '',
  logoUrl: '/blobs-logo.png',
  trailerUrl: '/blobs.mp4',
  tagline: 'Match colour blobs and drop blocks in a forest duel.',
  tags: ['Versus', 'Cozy'],
  choices: { genre: ['puzzle'] },
  stats: { plays: 31_400, version: '2.1.0' },
};
// Goblin Cellar is a real stored game whose detail data comes from the curated record.
const goblin: GameSummary = {
  ...mergeShowcase([
    {
      ...blobs,
      id: 'g-goblin',
      slug: 'goblin-cellar',
      title: 'Goblin Cellar',
      tags: undefined,
      tagline: undefined,
      stats: { plays: 31_400, version: '1.12.5' },
    },
  ])[0]!,
  logoUrl: '/goblin-logo.png',
};

function detail(game: GameSummary, props: Partial<Parameters<typeof GameDetail>[0]> = {}) {
  return render(<GameDetail game={game} onPlay={vi.fn()} onEdit={vi.fn()} onClose={vi.fn()} {...props} />);
}

// Element tags and classes only; repeated siblings (one chip per tag, one cell per stat) collapse to one,
// so two games differ here only if the layout itself differs.
function shape(element: Element): string {
  const children = [...element.children].map(shape).filter((child, index, all) => child !== all[index - 1]);
  const name = `${element.tagName.toLowerCase()}${[...element.classList].map((name) => `.${name}`).join('')}`;
  return element.tagName === 'DL' || element.tagName === 'svg' ? name : `${name}(${children.join(',')})`;
}

describe('game detail', () => {
  it('can dismiss with Escape as soon as the detail is committed', () => {
    const onClose = vi.fn();
    function PressEscape() {
      useLayoutEffect(() => {
        fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
      }, []);
      return null;
    }
    render(
      <>
        <GameDetail game={blobs} onPlay={vi.fn()} onEdit={vi.fn()} onClose={onClose} />
        <PressEscape />
      </>,
    );
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('renders the same layout and splatter border for every game, varying only the data', async () => {
    const views = [];
    for (const game of [blobs, goblin]) {
      const { container, unmount } = detail(game);
      const media = container.querySelector<HTMLElement>('.games-spotlight-media')!;
      await vi.waitFor(() => expect(media).toHaveAttribute('data-splat', 'true'));
      views.push({
        shape: shape(container.firstElementChild!),
        mask: media.style.maskImage,
        html: container.innerHTML,
      });
      unmount();
    }
    expect(views[0]!.shape).toBe(views[1]!.shape);
    // Kevin: "including the trailer border we use with goblins": one frame, not a per-game shape.
    expect(views[0]!.mask).toBe(views[1]!.mask);
    expect(views[0]!.mask).toContain('goblin-cellar');
    expect(vi.mocked(splatMask).mock.calls.every(([seed]) => seed === 'goblin-cellar')).toBe(true);
    expect(views[0]!.html).toContain('Match colour blobs');
    expect(views[1]!.html).toContain('Build a dungeon');
  });

  it('prefers published details over stale showcase data for matched games', () => {
    detail({
      ...goblin,
      tagline: 'Fresh description',
      tags: ['Puzzle'],
      choices: undefined,
      stats: { plays: 42, version: '9.0' },
    });
    expect(screen.getByText('Fresh description')).toBeVisible();
    expect(screen.getByText('Puzzle')).toBeVisible();
    expect(screen.queryByText('Dungeon')).toBeNull();
    expect(screen.getByText('42')).toBeVisible();
    expect(screen.getByText('v9.0')).toBeVisible();
  });

  it('does not present showcase placeholder stats as a real game’s measured data', () => {
    detail({ ...goblin, stats: undefined });
    expect(screen.queryByText('Plays')).toBeNull();
    expect(screen.queryByText('Rating')).toBeNull();
    expect(screen.queryByText('Time played')).toBeNull();
  });

  it('shows the name as text under an unobstructed trailer, never the logo', () => {
    const { container } = detail(blobs);
    expect(screen.getByRole('heading', { name: 'Blobs' })).toBeInTheDocument();
    expect(container.querySelector('img[src="/blobs-logo.png"]')).toBeNull();
    expect(container.querySelector('.game-logo')).toBeNull();
  });

  // Kevin, 2026-11-21: with no trailer yet, the expanded view shows the thumbnail with the logo on it, as the tile does.
  it('lays the logo over the cover when there is no trailer, shared cover or not', () => {
    const untrailered = { ...blobs, trailerUrl: undefined, coverUrl: '/cover.png' };
    for (const sharedCover of [false, true]) {
      const { container, unmount } = detail(untrailered, { sharedCover });
      expect(container.querySelector('video')).toBeNull();
      expect(
        container.querySelector('.games-spotlight-media .game-cover img.game-logo[src="/blobs-logo.png"]'),
      ).not.toBeNull();
      unmount();
    }
  });

  it('shows no logo for a game without one', () => {
    const { container } = detail({ ...blobs, trailerUrl: undefined, logoUrl: undefined, coverUrl: '/cover.png' });
    expect(container.querySelector('.game-logo')).toBeNull();
  });

  it('shows a published game its description, tag chips, stats and icon-only buttons', () => {
    detail(blobs);
    expect(screen.getByText('Match colour blobs and drop blocks in a forest duel.')).toBeVisible();
    const tags = screen.getByRole('list', { name: 'Tags' });
    expect([...tags.querySelectorAll('li')].map((item) => item.textContent)).toEqual(['Puzzle', 'Versus', 'Cozy']);
    expect(tags.querySelectorAll('svg')).toHaveLength(3);
    expect(screen.getByText('v2.1.0')).toBeVisible();
    expect(screen.getByText('31.4k')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Play Blobs' })).toHaveTextContent('▶');
    expect(screen.getByRole('button', { name: 'Edit Blobs' }).querySelector('svg')).not.toBeNull();
  });

  it('orders player tags first and uses the group icon for multiplayer', () => {
    const tags = detailOf({
      ...blobs,
      slug: 'other',
      tags: ['Puzzle', 'Multiplayer', 'Solo'],
      choices: undefined,
    }).tags;
    expect(tags.map(({ label }) => label)).toEqual(['Solo', 'Multiplayer', 'Puzzle']);
    expect(tags[1]?.key).toBe('party');
  });

  it('gives every tag on a card its own icon, genre before style (#1287)', () => {
    // Kevin on RestoreBound: four tags shared the generic sparkle. Each published game's list must stay distinct.
    const published: Pick<GameSummary, 'slug' | 'tags' | 'choices'>[] = [
      {
        slug: 'restorebound',
        tags: ['Pixel art', 'Turn-based', 'Story', 'Single player'],
        choices: { genre: ['RPG', 'Adventure'] },
      },
      { slug: 'dusk-helm', tags: undefined, choices: { genre: ['rpg', 'roguelike', 'adventure'] } },
      { slug: 'blobs', tags: ['Versus', 'Cozy', 'Solo', 'Multiplayer'], choices: undefined },
      {
        slug: 'odd',
        tags: ['Zany', 'Wacky', 'solo', 'Single-player', 'singleplayer', 'Narrative', 'Story'],
        choices: undefined,
      },
    ];
    for (const game of published) {
      const keys = detailOf({ ...blobs, ...game }).tags.map(({ key }) => key);
      expect(new Set(keys).size, `${game.slug}: ${keys.join(', ')}`).toBe(keys.length);
    }
    const restorebound = detailOf({ ...blobs, ...published[0] }).tags;
    expect(restorebound.map(({ label, key }) => `${label}:${key}`)).toEqual([
      'Single player:solo',
      'RPG:rpg',
      'Adventure:adventure',
      'Pixel art:pixel',
      'Turn-based:turns',
      'Story:story',
    ]);
  });

  it('keeps genre ahead of other play modes and style on curated cards', () => {
    // Little Fronts has nine curated tags; a phone row shows five, so its genre must not fall behind Versus/Online.
    const fronts = mergeShowcase([]).find(({ title }) => title === 'Little Fronts')!;
    const keys = detailOf(fronts).tags.map(({ key }) => key);
    expect(keys.slice(0, 5)).toEqual(['solo', 'strategy', 'battle', 'versus', 'online']);
    for (const card of mergeShowcase([])) {
      const cardKeys = detailOf(card).tags.map(({ key }) => key);
      expect(new Set(cardKeys).size, `${card.title}: ${cardKeys.join(', ')}`).toBe(cardKeys.length);
    }
  });

  it('colours a tag with no curated colour from the shared palette tokens', () => {
    // Chrome colours live only in tokens.css, so an unknown tag must reuse a token, never a literal.
    const [tag] = detailOf({ ...blobs, slug: 'other', tags: ['Zany'], choices: undefined }).tags;
    expect(tag!.key).toBe('other');
    expect(tag!.color).toMatch(/^var\(--(?:red|orange|yellow|green|aqua|blue|purple)-b\)$/);
    expect(detailOf({ ...blobs, slug: 'other', tags: ['Zany'], choices: undefined }).tags[0]!.color).toBe(tag!.color);
  });

  it('hides only the rows a game has no data for', () => {
    const { container } = detail({ ...blobs, tagline: undefined, tags: [], choices: undefined, slug: 'other' });
    expect(container.querySelector('.games-tagline')).toBeNull();
    expect(screen.queryByRole('list', { name: 'Tags' })).toBeNull();
    expect(screen.queryByText('Rating')).toBeNull();
    expect(screen.queryByText('Time played')).toBeNull();
    expect(screen.getByText('Plays')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Blobs' })).toBeInTheDocument();

    cleanup();
    const bare = detail({ ...blobs, tagline: undefined, tags: [], choices: undefined, slug: 'other', stats: {} });
    expect(bare.container.querySelector('.games-detail-stats')).toBeNull();
    expect(screen.getByRole('button', { name: 'Play Blobs' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Edit Blobs' })).toBeEnabled();
  });

  it('shows the puzzle tag for Blobs builds that predate genre metadata', () => {
    detail({ ...blobs, tags: [], choices: undefined });
    expect(screen.getByText('Puzzle')).toBeVisible();
  });

  it('shows the curated tags and stats and opens the selected action', () => {
    const play = vi.fn();
    detail(mergeShowcase([])[0]!, { onPlay: play });
    expect(screen.getByText('Dungeon')).toBeVisible();
    expect(screen.getByText('5h 25m')).toBeVisible();
    expect(screen.getByText('31.4k')).toBeVisible();
    expect(screen.getByLabelText('4.8 out of 5')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Play Goblin Cellar' }));
    expect(play).toHaveBeenCalledOnce();
  });

  it('shows published media for a real showcase game', () => {
    const { container } = detail({
      ...mergeShowcase([])[0]!,
      coverUrl: '/thumbnail.png',
      trailerUrl: '/landscape.mp4',
    });
    expect(container.querySelector('img[src="/thumbnail.png"]')).not.toBeNull();
    expect(container.querySelectorAll('video')).toHaveLength(1);
    expect(container.querySelector('video')).toHaveAttribute('src', '/landscape.mp4');
    expect(container.querySelector('video')).toHaveAttribute('poster', '/thumbnail.png');
  });

  it('uses the responsive cover beneath a shared trailer without loading the original poster', () => {
    const sources = Object.fromEntries(
      ['avif', 'webp', 'png'].map((format) => [
        format,
        [
          { width: 320, path: `/small.${format}` },
          { width: 640, path: `/large.${format}` },
        ],
      ]),
    );
    const game = {
      ...mergeShowcase([])[0]!,
      coverUrl: '/original.png',
      trailerUrl: '/trailer.mp4',
      coverImage: { width: 640, height: 360, sources },
    } as Parameters<typeof GameTrailer>[0]['game'];
    const { rerender } = render(<GameTrailer game={game} transparentPoster />);
    expect(screen.getByLabelText(`${game.title} trailer`).getAttribute('poster')).toMatch(/^data:image\/svg\+xml,/);
    rerender(<GameTrailer game={game} />);
    expect(screen.getByLabelText(`${game.title} trailer`)).toHaveAttribute('poster', '/large.webp');
  });

  it('loops the trailer with a transparent poster when no cover image exists', () => {
    const game = { ...mergeShowcase([])[0]!, coverUrl: null, trailerUrl: '/landscape.mp4' };
    render(<GameTrailer game={game} transparentPoster />);
    const video = screen.getByLabelText(`${game.title} trailer`);
    expect(video).toHaveAttribute('loop');
    expect(video).not.toHaveAttribute('controls');
    expect(video.getAttribute('poster')).toMatch(/^data:image\/svg\+xml,/);
    expect(video).toHaveAttribute('preload', 'auto');
  });
});
