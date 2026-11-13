import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GameManifest } from '@ogm/contracts/browser';

vi.mock('./SceneryThumbnail', () => ({
  SceneryThumbnail: ({ url }: { url: string }) => <img alt="" data-url={url} />,
}));
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
  it('renders an unhashed scenery prefab only from a build-pinned lock', () => {
    const scenery = {
      categories: [{ id: 'props', label: 'Forest', kind: 'items' as const }],
      items: [{ prefab: 'scenery:lantern', label: 'Lantern', category: 'props' }],
    };
    const assets = [{ id: 'lantern', sha256: 'locked', url: '/lantern.glb' }];
    const { rerender } = render(<Palette palette={scenery} onPick={vi.fn()} sceneryAssets={assets} />);
    expect(screen.queryByRole('presentation')).not.toBeInTheDocument();
    rerender(<Palette palette={scenery} onPick={vi.fn()} sceneryAssets={assets} buildPinnedAssets />);
    expect(screen.getByRole('presentation')).toHaveAttribute('data-url', '/lantern.glb');
    rerender(
      <Palette
        palette={{ ...scenery, items: [{ prefab: 'native', label: 'Lantern', category: 'props', assetId: 'lantern' }] }}
        onPick={vi.fn()}
        sceneryAssets={assets}
        buildPinnedAssets
      />,
    );
    expect(screen.queryByRole('presentation')).not.toBeInTheDocument();
  });
  it('renders a native prefab model only when its explicit asset ID and hash match', () => {
    const native = {
      categories: [{ id: 'monsters', label: 'Monsters', kind: 'items' as const }],
      items: [{ prefab: 'goblin1', label: 'Goblin', category: 'monsters', assetId: 'orc', assetSha: 'matching' }],
    };
    const onPick = vi.fn();
    const { rerender } = render(
      <Palette palette={native} onPick={onPick} sceneryAssets={[{ id: 'orc', sha256: 'old', url: '/orc.glb' }]} />,
    );
    expect(screen.queryByRole('presentation')).not.toBeInTheDocument();
    rerender(
      <Palette palette={native} onPick={onPick} sceneryAssets={[{ id: 'orc', sha256: 'matching', url: '/orc.glb' }]} />,
    );
    expect(screen.getByRole('presentation')).toHaveAttribute('data-url', '/orc.glb');
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Goblin' }));
    expect(onPick).toHaveBeenCalledWith('goblin1');
  });
  it('renders a model thumbnail only when the source hash matches the built palette', () => {
    const scenery = {
      categories: [{ id: 'trees', label: 'Trees', kind: 'items' as const }],
      items: [{ prefab: 'scenery:oak', label: 'Oak', category: 'trees', assetSha: 'matching' }],
    };
    const { rerender } = render(
      <Palette
        palette={scenery}
        onPick={vi.fn()}
        sceneryAssets={[{ id: 'oak', sha256: 'different', url: '/tree.glb' }]}
      />,
    );
    expect(screen.queryByRole('presentation')).not.toBeInTheDocument();
    rerender(
      <Palette
        palette={scenery}
        onPick={vi.fn()}
        sceneryAssets={[{ id: 'oak', sha256: 'matching', url: '/tree.glb' }]}
      />,
    );
    expect(screen.getByRole('presentation')).toHaveAttribute('data-url', '/tree.glb');
  });
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
