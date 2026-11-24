import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DisplayImage } from './DisplayImage';

afterEach(cleanup);

const image = (name: string) => ({
  width: 640,
  height: 360,
  sources: {
    avif: [{ width: 320, path: `/${name}-320.avif` }],
    webp: [
      { width: 640, path: `/${name}-640.webp` },
      { width: 320, path: `/${name}-320.webp` },
    ],
    png: [{ width: 320, path: `/${name}-320.png` }],
  },
});

function load(img: HTMLImageElement) {
  Object.defineProperty(img, 'naturalWidth', { configurable: true, value: 640 });
  fireEvent.load(img);
}

describe('display images', () => {
  // Kevin's list showed the cached build's logo, then the live list named a new build and the logo went blank (#1312).
  it('keeps the shown art on screen until the changed art has loaded', () => {
    const { container, rerender } = render(
      <DisplayImage className="game-logo" src="/old.png" image={image('old')} sizes="100vw" keepShown />,
    );
    const old = container.querySelector('img')!;
    load(old);

    rerender(<DisplayImage className="game-logo" src="/new.png" sizes="100vw" keepShown />);
    const imgs = [...container.querySelectorAll('img')];
    expect(imgs).toHaveLength(2);
    expect(imgs[0]).toHaveAttribute('src', '/new.png');
    // The very element already showing the art is kept, so nothing reloads or flashes.
    expect(imgs[1]).toBe(old);
    expect(old).toHaveClass('game-logo', 'is-held');

    load(imgs[0]!);
    expect([...container.querySelectorAll('img')]).toEqual([imgs[0]]);
  });

  it('keeps the shown art through a second change made before the first one loaded', () => {
    const { container, rerender } = render(<DisplayImage className="game-logo" src="/a.png" sizes="100vw" keepShown />);
    const shown = container.querySelector('img')!;
    load(shown);
    rerender(<DisplayImage className="game-logo" src="/b.png" sizes="100vw" keepShown />);
    rerender(<DisplayImage className="game-logo" src="/c.png" sizes="100vw" keepShown />);
    const imgs = [...container.querySelectorAll('img')];
    expect(imgs.map((img) => img.getAttribute('src'))).toEqual(['/c.png', '/a.png']);
    expect(imgs[1]).toBe(shown);
  });

  it('keeps nothing extra when the art was never shown', () => {
    const { container, rerender } = render(
      <DisplayImage className="game-logo" src="/old.png" sizes="100vw" keepShown />,
    );
    rerender(<DisplayImage className="game-logo" src="/new.png" sizes="100vw" keepShown />);
    expect(container.querySelectorAll('img')).toHaveLength(1);
  });

  it('paints the smallest variant behind a loading cover, never a blank card', () => {
    const { container } = render(
      <DisplayImage className="game-cover-image" src="/cover.png" image={image('cover')} sizes="100vw" placeholder />,
    );
    const img = container.querySelector('img')!;
    expect(img.style.backgroundImage).toBe('url("/cover-320.webp")');

    load(img);
    expect(img.style.backgroundImage).toBe('');
  });
});
