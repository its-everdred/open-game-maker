import type { Frame } from 'playwright';

export type ImageDistortion = {
  element: string;
  file: string;
  natural: number;
  drawn: number;
  viewport: string;
  screen: string;
};

/** Measure raster images in the game frame at the moment a screen is captured. */
export async function measureImageDistortion(
  frame: Frame,
  viewport: string,
  screen: string,
): Promise<ImageDistortion[]> {
  const findings = await frame.evaluate(async () => {
    const results: { element: string; file: string; natural: number; drawn: number }[] = [];
    const selector = (element: Element): string => {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const parts: string[] = [];
      for (let node: Element | null = element; node && node !== document.documentElement; node = node.parentElement) {
        const siblings = node.parentElement
          ? Array.from(node.parentElement.children).filter((s) => s.tagName === node!.tagName)
          : [];
        parts.unshift(
          `${node.tagName.toLowerCase()}${siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(node) + 1})` : ''}`,
        );
      }
      return parts.join(' > ');
    };
    const add = (element: Element, file: string, natural: number, drawn: number) => {
      if (Number.isFinite(natural) && Number.isFinite(drawn) && natural > 0 && Math.abs(drawn / natural - 1) > 0.02)
        results.push({ element: selector(element), file, natural, drawn });
    };
    const raster = (url: string) => !/\.svg(?:[?#]|$)/i.test(url) && !/^data:image\/svg\+xml/i.test(url);
    for (const element of document.querySelectorAll<HTMLElement>('*')) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (
        Math.max(rect.width, rect.height) < 24 ||
        rect.right <= 0 ||
        rect.bottom <= 0 ||
        rect.left >= innerWidth ||
        rect.top >= innerHeight ||
        style.visibility !== 'visible' ||
        style.display === 'none' ||
        Number(style.opacity) === 0
      )
        continue;
      let hidden = false;
      let visible = {
        left: Math.max(0, rect.left),
        top: Math.max(0, rect.top),
        right: Math.min(innerWidth, rect.right),
        bottom: Math.min(innerHeight, rect.bottom),
      };
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const ancestor = getComputedStyle(parent);
        if (ancestor.display === 'none' || ancestor.visibility !== 'visible' || Number(ancestor.opacity) === 0) {
          hidden = true;
          break;
        }
        const bounds = parent.getBoundingClientRect();
        if (['hidden', 'clip', 'auto', 'scroll'].includes(ancestor.overflowX))
          visible = {
            ...visible,
            left: Math.max(visible.left, bounds.left),
            right: Math.min(visible.right, bounds.right),
          };
        if (['hidden', 'clip', 'auto', 'scroll'].includes(ancestor.overflowY))
          visible = {
            ...visible,
            top: Math.max(visible.top, bounds.top),
            bottom: Math.min(visible.bottom, bounds.bottom),
          };
      }
      if (hidden || visible.left >= visible.right || visible.top >= visible.bottom) continue;
      if (
        element instanceof HTMLImageElement &&
        element.naturalWidth &&
        element.naturalHeight &&
        style.objectFit === 'fill' &&
        raster(element.currentSrc)
      ) {
        const width =
          rect.width -
          parseFloat(style.borderLeftWidth) -
          parseFloat(style.borderRightWidth) -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight);
        const height =
          rect.height -
          parseFloat(style.borderTopWidth) -
          parseFloat(style.borderBottomWidth) -
          parseFloat(style.paddingTop) -
          parseFloat(style.paddingBottom);
        add(element, element.currentSrc, element.naturalWidth / element.naturalHeight, width / height);
      }
      const layers: string[] = [];
      let depth = 0;
      let start = 0;
      for (let i = 0; i < style.backgroundImage.length; i++) {
        const character = style.backgroundImage[i];
        if (character === '(') depth++;
        if (character === ')') depth--;
        if (character === ',' && depth === 0) {
          layers.push(style.backgroundImage.slice(start, i));
          start = i + 1;
        }
      }
      layers.push(style.backgroundImage.slice(start));
      const sizes = style.backgroundSize.split(',');
      const origins = style.backgroundOrigin.split(',');
      for (const [index, layer] of layers.entries()) {
        const match = /url\(["']?([^"')]+)["']?\)/.exec(layer);
        if (!match) continue;
        if (!raster(match[1]!)) continue;
        const size = (sizes[index] ?? sizes[0] ?? '').trim().split(/\s+/);
        if (size.length !== 2 || size.some((part) => part === 'auto' || part === 'cover' || part === 'contain'))
          continue;
        const dimension = (value: string, extent: number): number =>
          value.endsWith('%') ? (parseFloat(value) * extent) / 100 : value.endsWith('px') ? parseFloat(value) : NaN;
        const origin = (origins[index] ?? origins[0] ?? '').trim();
        const boxWidth =
          origin === 'border-box'
            ? element.offsetWidth
            : origin === 'content-box'
              ? element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
              : element.clientWidth;
        const boxHeight =
          origin === 'border-box'
            ? element.offsetHeight
            : origin === 'content-box'
              ? element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
              : element.clientHeight;
        const width = dimension(size[0]!, boxWidth);
        const height = dimension(size[1]!, boxHeight);
        const image = new Image();
        image.src = match[1]!;
        await image.decode().catch(() => undefined);
        if (image.naturalWidth && image.naturalHeight)
          add(element, image.src, image.naturalWidth / image.naturalHeight, width / height);
      }
    }
    const gm = (
      window as unknown as {
        __gm?: {
          imageDraws?: () => {
            id: string;
            file: string;
            source: { width: number; height: number };
            drawn: { width: number; height: number };
          }[];
        };
      }
    ).__gm;
    for (const sprite of gm?.imageDraws?.() ?? []) {
      const natural = sprite.source.width / sprite.source.height;
      const drawn = sprite.drawn.width / sprite.drawn.height;
      if (
        Math.max(sprite.drawn.width, sprite.drawn.height) >= 24 &&
        Number.isFinite(natural) &&
        natural > 0 &&
        Number.isFinite(drawn) &&
        Math.abs(drawn / natural - 1) > 0.02
      )
        results.push({ element: sprite.id, file: sprite.file, natural, drawn });
    }
    return results;
  });
  return findings.map((item) => ({ ...item, viewport, screen }));
}
