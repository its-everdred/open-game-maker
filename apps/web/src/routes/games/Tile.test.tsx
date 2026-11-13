import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mergeShowcase } from './showcase';
import { Tile } from './Tile';

afterEach(cleanup);

describe('showcase tile', () => {
  it('shows the featured badge, title, icons and rating from the prototype', () => {
    const game = mergeShowcase([]).find((entry) => entry.title === 'RestoreBound')!;
    render(<Tile game={game} selected={false} tabIndex={0} onClick={vi.fn()} onFocus={vi.fn()} />);
    expect(screen.getByText('Featured')).toBeVisible();
    expect(screen.getAllByText('RestoreBound').length).toBeGreaterThan(0);
    expect(screen.getByText('★ 4.7')).toBeVisible();
    expect(screen.getByLabelText('Adventure, Craft, Cozy, Calm')).toBeInTheDocument();
  });
});
