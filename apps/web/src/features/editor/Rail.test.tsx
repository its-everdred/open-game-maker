import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('./SceneryThumbnail', () => ({
  SceneryThumbnail: ({ url }: { url: string }) => <img alt="" data-url={url} />,
}));
import { Rail } from './Rail';

afterEach(cleanup);

it('renders a terrain brush preview and never a placeholder letter', () => {
  render(
    <Rail
      categories={[
        { id: 'arena', label: 'Arena', kind: 'items' },
        { id: 'ground', label: 'Ground', kind: 'items' },
      ]}
      items={[
        { prefab: 'seat', label: 'Seat', category: 'arena' },
        { prefab: 'scenery-band:grass', label: 'Grass', category: 'ground' },
      ]}
      onChange={vi.fn()}
    />,
  );
  expect(screen.getByRole('button', { name: 'Arena' })).toHaveTextContent(/^Arena$/);
  expect(screen.getByRole('button', { name: 'Ground' }).querySelector('svg')).toBeInTheDocument();
});

it('uses a hash-matched real scenery model for its category thumbnail', () => {
  const props = {
    categories: [{ id: 'trees', label: 'Trees', kind: 'items' as const }],
    items: [
      { prefab: 'empty', label: 'Empty', category: 'trees' },
      { prefab: 'scenery:oak', label: 'Oak', category: 'trees', assetSha: 'matching' },
    ],
    onChange: vi.fn(),
  };
  const { rerender } = render(<Rail {...props} sceneryAssets={[{ id: 'oak', sha256: 'old', url: '/oak.glb' }]} />);
  expect(screen.queryByRole('presentation')).not.toBeInTheDocument();
  rerender(<Rail {...props} sceneryAssets={[{ id: 'oak', sha256: 'matching', url: '/oak.glb' }]} />);
  expect(screen.getByRole('presentation')).toHaveAttribute('data-url', '/oak.glb');
});

it('uses a native prefab asset for its category without changing the selection ID', () => {
  const onChange = vi.fn();
  render(
    <Rail
      categories={[{ id: 'monsters', label: 'Monsters', kind: 'items' }]}
      items={[{ prefab: 'goblin1', label: 'Goblin', category: 'monsters', assetId: 'orc', assetSha: 'hash' }]}
      sceneryAssets={[{ id: 'orc', sha256: 'hash', url: '/orc.glb' }]}
      onChange={onChange}
    />,
  );
  expect(screen.getByRole('presentation')).toHaveAttribute('data-url', '/orc.glb');
  screen.getByRole('button', { name: 'Monsters' }).click();
  expect(onChange).toHaveBeenCalledWith('monsters');
});
