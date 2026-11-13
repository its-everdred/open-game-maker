import { useEffect, useRef, useState } from 'react';

/** Generate only thumbnails that are visible in the scrolling palette. */
export function SceneryThumbnail({ url }: { url: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [image, setImage] = useState<string>();
  useEffect(() => {
    let active = true;
    let requested = false;
    const start = () => {
      if (requested) return;
      requested = true;
      void import('./scenery-thumbnail-renderer')
        .then(({ renderSceneryThumbnail }) => renderSceneryThumbnail(url))
        .then((value) => {
          if (active) setImage(value);
        })
        .catch(() => undefined);
    };
    const element = ref.current;
    let observer: IntersectionObserver | undefined;
    if (element && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          start();
          observer?.disconnect();
        }
      });
      observer.observe(element);
    } else start();
    return () => {
      active = false;
      observer?.disconnect();
    };
  }, [url]);
  return (
    <span ref={ref} className="scenery-thumbnail">
      {image ? <img src={image} alt="" /> : null}
    </span>
  );
}
