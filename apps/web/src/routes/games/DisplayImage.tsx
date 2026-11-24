import { Fragment, useState, type CSSProperties, type SyntheticEvent } from 'react';
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
  /** Paint the image's smallest variant behind it until it loads (opaque covers only). */
  placeholder?: boolean;
  /** Keep the art on screen until changed art has loaded (positioned layers: covers and list logos). */
  keepShown?: boolean;
};

type Layer = {
  className: string;
  onLoad?: (event: SyntheticEvent<HTMLImageElement>) => void;
  style?: CSSProperties;
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
    for (const viewport of [
      'phone-portrait',
      'phone-landscape',
      'tablet-portrait',
      'tablet-landscape',
      'desktop',
    ] as const) {
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

// A list refresh can point a card at a new build's art. The art already on screen stays until the new art has loaded,
// so a logo or cover never blanks out while it changes.
export function DisplayImage(props: Props) {
  const key = sourceKey(props);
  const [loaded, setLoaded] = useState<{ key: string; props: Props } | null>(null);
  const settled = loaded?.key === key;
  const onLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    if (event.currentTarget.naturalWidth > 0 && !settled) setLoaded({ key, props });
  };
  const tiny = props.placeholder && !settled ? smallest(props) : undefined;
  const current = renderImage(props, {
    className: props.className,
    onLoad,
    style: tiny
      ? { backgroundImage: `url("${tiny}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
      : undefined,
  });
  if (!props.keepShown) return current;
  // Keyed by source, so the element already showing the old art is the one kept (no reload, no flash).
  return (
    <>
      <Fragment key={key}>{current}</Fragment>
      {loaded && !settled && (
        <Fragment key={loaded.key}>
          {renderImage(loaded.props, { className: `${loaded.props.className} is-held` })}
        </Fragment>
      )}
    </>
  );
}

function sourceKey({ image, variants, src }: Props): string {
  const first = (entry?: DisplayImage | null) => entry?.sources.webp[0]?.path ?? '';
  return [src, first(image), ...Object.values(variants ?? {}).map(first)].join(' ');
}

function smallest({ image, variants }: Props): string | undefined {
  const source = image ?? Object.values(variants ?? {}).find(Boolean);
  return source?.sources.webp.reduce((best, entry) => (entry.width < best.width ? entry : best)).path;
}

function renderImage({ image, variants, src, sizes, priority = false }: Props, { className, onLoad, style }: Layer) {
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
            onLoad={onLoad}
            style={style}
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
          <img
            className={className}
            onLoad={onLoad}
            style={style}
            src={src}
            alt=""
            width={320}
            height={180}
            loading={priority ? 'eager' : 'lazy'}
            fetchPriority={priority ? 'high' : 'auto'}
          />
        )}
      </picture>
    );
  }
  if (!image)
    return (
      <img
        className={className}
        onLoad={onLoad}
        style={style}
        src={src}
        alt=""
        width={320}
        height={180}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
      />
    );
  return (
    <picture className="game-display-picture">
      <source type="image/avif" srcSet={srcSet(image.sources.avif)} sizes={sizes} />
      <source type="image/webp" srcSet={srcSet(image.sources.webp)} sizes={sizes} />
      <img
        className={className}
        onLoad={onLoad}
        style={style}
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
