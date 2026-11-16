import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Cover } from './Cover';
import { mergeShowcase } from './showcase';

afterEach(cleanup);

describe('game covers', () => {
  it('offers responsive formats and an eager selected cover', () => {
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
      title: 'Example',
      coverUrl: '/original.png',
      coverImage: { width: 640, height: 360, sources },
    } as Parameters<typeof Cover>[0]['game'];
    const { container } = render(<Cover game={game} hero />);
    expect(container.querySelector('source[type="image/avif"]')).toHaveAttribute(
      'srcset',
      '/small.avif 320w, /large.avif 640w',
    );
    expect(container.querySelector('img')).toHaveAttribute('width', '640');
    expect(container.querySelector('img')).toHaveAttribute('loading', 'eager');
  });

  it('uses the prototype scene for a showcase entry', () => {
    const game = mergeShowcase([]).find((entry) => entry.title === 'RestoreBound')!;
    const { container } = render(<Cover game={game} />);
    expect(container.querySelector('canvas')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('RestoreBound')).toBeInTheDocument();
  });
});
