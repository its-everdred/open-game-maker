import { preload } from 'react-dom';
import type { ViewportId } from '@ogm/contracts';
import type { DisplayImage } from './types';

type Props = {
  image?: DisplayImage | null;
  variants?: Partial<Record<ViewportId, DisplayImage>>;
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
  variants?: Partial<Record<ViewportId, DisplayImage>>,
) {
  if (!src) return;
  if (variants) {
    let preloadedVariant = false;
    for (const viewport of ['phone-portrait', 'phone-landscape', 'tablet-portrait', 'tablet-landscape', 'desktop'] as const) {
      const variant = variants[viewport];
      if (!variant) continue;
      preloadedVariant = true;
      preload(variant.sources.avif[0]!.path, {
        as: 'image',
        type: 'image/avif',
        imageSrcSet: srcSet(variant.sources.avif),
        imageSizes: sizes,
        media: viewportMedia[viewport],
        fetchPriority: 'high',
      });
    }
    if (preloadedVariant) return;
  }
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

const viewportMedia: Record<ViewportId, string> = {
  'phone-portrait': '(max-width: 600px) and (orientation: portrait)',
  'phone-landscape': '(max-width: 1000px) and (orientation: landscape)',
  'tablet-portrait': '(min-width: 601px) and (max-width: 1000px) and (orientation: portrait)',
  'tablet-landscape': '(min-width: 1001px) and (max-width: 1439px) and (orientation: landscape)',
  desktop: '(min-width: 1440px)',
};

const formats = ['avif', 'webp', 'png'] as const;

export function DisplayImage({ image, variants, src, className, sizes, priority = false }: Props) {
  if (variants && Object.keys(variants).length > 0) {
    return (
      <picture className="game-display-picture">
        {(['phone-portrait', 'phone-landscape', 'tablet-portrait', 'tablet-landscape', 'desktop'] as const).flatMap(
          (viewport) => {
            const variant = variants[viewport];
            if (!variant) return [];
            return formats.flatMap((format) => {
              const entries = variant.sources[format];
              if (!entries.length) return [];
              return (
                <source
                  key={`${viewport}-${format}`}
                  media={viewportMedia[viewport]}
                  type={`image/${format}`}
                  srcSet={srcSet(entries)}
                  sizes={sizes}
                />
              );
            });
          },
        )}
        {image ? (
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
        ) : (
          <img className={className} src={src} alt="" width={320} height={180} loading={priority ? 'eager' : 'lazy'} />
        )}
      </picture>
    );
  }
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
