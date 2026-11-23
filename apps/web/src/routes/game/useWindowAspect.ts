import { useEffect, useState } from 'react';

/** True while a text field has focus, through open shadow roots (the chat composer is a custom element). */
function typing() {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return !!active?.matches('input, textarea, [contenteditable=""], [contenteditable="true"]');
}

/** The window's width / height as a CSS ratio, so the edit preview turns with the device. */
export function useWindowAspect() {
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    const update = () =>
      setSize((last) =>
        /* A phone keyboard only shortens the window; keep the preview's shape while the creator types. */
        window.innerWidth === last.width && typing() ? last : { width: window.innerWidth, height: window.innerHeight },
      );
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return `${size.width} / ${size.height}`;
}
