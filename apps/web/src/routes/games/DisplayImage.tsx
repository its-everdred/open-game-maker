import { preload } from 'react-dom';
import type { DisplayImage } from './types';

type Props = {
  image?: DisplayImage | null;
  src: string;
  className: string;
  sizes: string;
  priority?: boolean;
};

const srcSet = (entries: DisplayImage['sources']['avif']) =>
  entries.map(({ path, width }) => `${path} ${width}w`).join(', ');

export function preloadDisplayImage(
  image: DisplayImage | null | undefined,
  src: string | null | undefined,
  sizes: string,
) {
  if (!src) return;
  if (image) {
    preload(image.sources.avif[0]!.path, {
      as: 'image',
      type: 'image/avif',
      imageSrcSet: srcSet(image.sources.avif),
      imageSizes: sizes,
      fetchPriority: 'high',
    });
  } else preload(src, { as: 'image', fetchPriority: 'high' });
}

export function DisplayImage({ image, src, className, sizes, priority = false }: Props) {
  if (!image)
    return (
      <img className={className} src={src} alt="" width={320} height={180} loading={priority ? 'eager' : 'lazy'} />
    );
  return (
    <picture className="game-display-picture">
      <source type="image/avif" srcSet={srcSet(image.sources.avif)} sizes={sizes} />
      <source type="image/webp" srcSet={srcSet(image.sources.webp)} sizes={sizes} />
      <img
        className={className}
        src={image.sources.webp[0]!.path}
        srcSet={srcSet(image.sources.webp)}
        sizes={sizes}
        width={image.width}
        height={image.height}
        alt=""
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
      />
    </picture>
  );
}
