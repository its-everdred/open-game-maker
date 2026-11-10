import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GameManifest } from '@ogm/contracts/browser';

import { Palette } from './Palette';

const palette: GameManifest['palette'] = {
  categories: [
    { id: 'actors', label: 'Actors', kind: 'items' },
    { id: 'terrain', label: 'Terrain', kind: 'items' },
  ],
  items: [
    {
      prefab: 'skeleton',
      label: 'Skeleton',
      category: 'actors',
      hint: 'A bony guard',
      aiGenerated: true,
    },
    { prefab: 'wall', label: 'Wall', category: 'terrain' },
  ],
};

afterEach(cleanup);

describe('Palette', () => {
  it('switches categories and chooses an item without inventing manifest copy', () => {
    const onPick = vi.fn();
    render(<Palette palette={palette} onPick={onPick} />);

    expect(screen.getByRole('button', { name: 'Skeleton, AI-generated' })).toBeVisible();
    expect(screen.getByLabelText('AI-generated')).toHaveTextContent('AI');
    fireEvent.click(screen.getByRole('tab', { name: 'Terrain' }));
    expect(screen.getByRole('button', { name: 'Wall' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Skeleton, AI-generated' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Wall' }));
    expect(onPick).toHaveBeenCalledWith('wall');
  });
});
