import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('./SceneryThumbnail', () => ({
  SceneryThumbnail: ({ url }: { url: string }) => <img alt="" data-url={url} />,
}));
import { Rail } from './Rail';

afterEach(cleanup);

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
