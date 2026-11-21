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
    expect(container.querySelector('img')).toHaveAttribute('src', '/small.webp');
    expect(container.querySelector('img')).toHaveAttribute('srcset', '/small.webp 320w, /large.webp 640w');
    expect(container.querySelector('img')).toHaveAttribute('loading', 'eager');
  });

  it('renders tile portrait sources before landscape variants', () => {
    const image = (name: string) => ({
      width: 400,
      height: 600,
      sources: Object.fromEntries(
        ['avif', 'webp', 'png'].map((format) => [format, [{ width: 400, path: `/${name}.${format}` }]]),
      ),
    });
    const game = {
      title: 'Example',
      coverUrl: '/original.png',
      slotImages: { tile: { 'phone-portrait': image('portrait'), 'phone-landscape': image('landscape') } },
    } as Parameters<typeof Cover>[0]['game'];
    const { container } = render(<Cover game={game} />);
    const sources = [...container.querySelectorAll('source')];
    expect(sources[0]).toHaveAttribute('media', '(max-width: 600px) and (orientation: portrait)');
    expect(sources[3]).toHaveAttribute('media', '(max-width: 1000px) and (orientation: landscape)');
    expect(sources.slice(0, 3).map((source) => source.getAttribute('srcset'))).toEqual([
      '/portrait.avif 400w',
      '/portrait.webp 400w',
      '/portrait.png 400w',
    ]);
    expect(sources.slice(3, 6).map((source) => source.getAttribute('srcset'))).toEqual([
      '/landscape.avif 400w',
      '/landscape.webp 400w',
      '/landscape.png 400w',
    ]);
  });

  it('maps every tile viewport to its responsive media query', () => {
    const image = (name: string) => ({
      width: 400,
      height: 600,
      sources: Object.fromEntries(
        ['avif', 'webp', 'png'].map((format) => [format, [{ width: 400, path: `/${name}.${format}` }]]),
      ),
    });
    const variants = {
      'phone-portrait': image('phone-portrait'),
      'phone-landscape': image('phone-landscape'),
      'tablet-portrait': image('tablet-portrait'),
      'tablet-landscape': image('tablet-landscape'),
      desktop: image('desktop'),
    };
    const { container } = render(
      <Cover
        game={
          { title: 'Example', coverUrl: '/original.png', slotImages: { tile: variants } } as Parameters<
            typeof Cover
          >[0]['game']
        }
      />,
    );
    const sources = [...container.querySelectorAll('source')];
    expect(
      sources.filter((source) => source.getAttribute('type') === 'image/avif').map((source) => source.media),
    ).toEqual([
      '(max-width: 600px) and (orientation: portrait)',
      '(max-width: 1000px) and (orientation: landscape)',
      '(min-width: 601px) and (max-width: 1000px) and (orientation: portrait)',
      '(min-width: 1001px) and (max-width: 1439px) and (orientation: landscape)',
      '(min-width: 1440px)',
    ]);
  });

  it("keeps today's image markup when viewport variants are absent", () => {
    const { container } = render(
      <Cover
        game={
          {
            title: 'Example',
            coverUrl: '/original.png',
          } as Parameters<typeof Cover>[0]['game']
        }
      />,
    );
    expect(container.querySelector('picture')).toBeNull();
    expect(container.querySelector('img')).toHaveAttribute('src', '/original.png');
    expect(container.querySelector('img')).toHaveAttribute('width', '320');
    expect(container.querySelector('img')).toHaveAttribute('height', '180');
    expect(container.querySelector('img')).toHaveAttribute('loading', 'lazy');
  });

  it('uses the legacy image as the fallback inside a variant picture', () => {
    const variant = {
      width: 390,
      height: 844,
      sources: {
        avif: [{ width: 390, path: '/portrait.avif' }],
        webp: [{ width: 390, path: '/portrait.webp' }],
        png: [{ width: 390, path: '/portrait.png' }],
      },
    };
    const { container } = render(
      <Cover
        game={
          {
            title: 'Example',
            coverUrl: '/original.png',
            slotImages: { tile: { 'phone-portrait': variant } },
          } as Parameters<typeof Cover>[0]['game']
        }
      />,
    );
    expect(container.querySelector('img')).toHaveAttribute('src', '/original.png');
    expect(container.querySelector('img')).toHaveAttribute('loading', 'lazy');
  });

  it('uses the prototype scene for a showcase entry', () => {
    const game = mergeShowcase([]).find((entry) => entry.title === 'Mossy Leap')!;
    const { container } = render(<Cover game={game} />);
    expect(container.querySelector('canvas')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('Mossy Leap')).toBeInTheDocument();
  });
});
