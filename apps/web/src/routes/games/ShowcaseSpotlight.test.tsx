import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mergeShowcase } from './showcase';
import { ShowcaseSpotlight } from './ShowcaseSpotlight';

afterEach(cleanup);

describe('showcase detail', () => {
  it('shows the prototype tags and stats and opens the selected action', () => {
    const game = mergeShowcase([]).find((entry) => entry.title === 'Goblin Cellar')!;
    const play = vi.fn();
    render(<ShowcaseSpotlight game={game} canOpen onPlay={play} onEdit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('Dungeon')).toBeVisible();
    expect(screen.getByText('5h 25m')).toBeVisible();
    expect(screen.getByText('31.4k')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Play Goblin Cellar' }));
    expect(play).toHaveBeenCalledOnce();
  });
});
