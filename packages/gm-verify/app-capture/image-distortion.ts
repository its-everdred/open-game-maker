import type { Frame } from 'playwright';

export type ImageDistortion = {
  element: string;
  file: string;
  natural: number;
  drawn: number;
  viewport: string;
  screen: string;
  error?: string;
};

/** Measure raster images in the game frame at the moment a screen is captured. */
export async function measureImageDistortion(
  frame: Frame,
  viewport: string,
  screen: string,
  requireSpriteReports = false,
): Promise<ImageDistortion[]> {
  const findings = await frame.evaluate(async (requireReports) => {
    const results: { element: string; file: string; natural: number; drawn: number; error?: string }[] = [];
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
      if (
        Number.isFinite(natural) &&
        Number.isFinite(drawn) &&
        natural > 0 &&
        Math.abs(drawn / natural - 1) > 0.02 + 1e-9
      )
        results.push({ element: selector(element), file, natural, drawn });
    };
    const raster = (url: string) => !/\.svg(?:[?#]|$)/i.test(url) && !/^data:image\/svg\+xml/i.test(url);
    const splitSize = (value: string) => {
      const parts: string[] = [];
      let depth = 0;
      let start = 0;
      for (let i = 0; i < value.length; i++) {
        if (value[i] === '(') depth++;
        if (value[i] === ')') depth--;
        if (/\s/.test(value[i]!) && depth === 0) {
          if (i > start) parts.push(value.slice(start, i));
          start = i + 1;
        }
      }
      if (start < value.length) parts.push(value.slice(start));
      return parts;
    };
    const splitLayers = (value: string) => {
      const layers: string[] = [];
      let depth = 0;
      let start = 0;
      for (let i = 0; i < value.length; i++) {
        if (value[i] === '(') depth++;
        if (value[i] === ')') depth--;
        if (value[i] === ',' && depth === 0) {
          layers.push(value.slice(start, i));
          start = i + 1;
        }
      }
      layers.push(value.slice(start));
      return layers;
    };
    const dimension = (value: string, extent: number): number => {
      const parent = document.createElement('div');
      parent.style.cssText = `position:fixed;visibility:hidden;left:-10000px;width:${extent}px;height:0`;
      const probe = document.createElement('div');
      probe.style.width = value;
      parent.append(probe);
      document.body.append(parent);
      const result = probe.getBoundingClientRect().width;
      parent.remove();
      return result;
    };
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
      let transform = new DOMMatrix();
      for (let node: HTMLElement | null = element; node; node = node.parentElement) {
        const computed = getComputedStyle(node);
        const matrix = computed.transform;
        if (matrix !== 'none') transform = new DOMMatrix(matrix).multiply(transform);
        if (computed.scale !== 'none') {
          const parts = computed.scale.split(/\s+/).map(Number);
          transform = new DOMMatrix().scale(parts[0]!, parts[1] ?? parts[0]!).multiply(transform);
        }
      }
      const scaleRatio = Math.hypot(transform.a, transform.b) / Math.hypot(transform.c, transform.d);
      if (
        element instanceof HTMLImageElement &&
        element.naturalWidth &&
        element.naturalHeight &&
        raster(element.currentSrc)
      ) {
        const width =
          element.offsetWidth -
          parseFloat(style.borderLeftWidth) -
          parseFloat(style.borderRightWidth) -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight);
        const height =
          element.offsetHeight -
          parseFloat(style.borderTopWidth) -
          parseFloat(style.borderBottomWidth) -
          parseFloat(style.paddingTop) -
          parseFloat(style.paddingBottom);
        const natural = element.naturalWidth / element.naturalHeight;
        const drawn = style.objectFit === 'fill' ? width / height : natural;
        add(element, element.currentSrc, natural, drawn * scaleRatio);
      }
      const layers = splitLayers(style.backgroundImage);
      const sizes = splitLayers(style.backgroundSize);
      const origins = splitLayers(style.backgroundOrigin);
      for (const [index, layer] of layers.entries()) {
        if (/image-set\(/i.test(layer)) {
          const candidates = [...layer.matchAll(/url\(["']?([^"')]+)["']?\)/g)];
          if (candidates.length === 0 || candidates.some((candidate) => raster(candidate[1]!)))
            results.push({
              element: selector(element),
              file: layer,
              natural: 0,
              drawn: 0,
              error: 'image-set cannot be measured reliably',
            });
          continue;
        }
        const match = /url\(["']?([^"')]+)["']?\)/.exec(layer);
        if (!match) continue;
        if (!raster(match[1]!)) continue;
        const size = splitSize((sizes[index] ?? sizes[0] ?? '').trim());
        const image = new Image();
        image.src = match[1]!;
        await image.decode().catch(() => undefined);
        if (!image.naturalWidth || !image.naturalHeight) continue;
        const natural = image.naturalWidth / image.naturalHeight;
        if (size.length === 1 || size.some((part) => part === 'auto' || part === 'cover' || part === 'contain')) {
          add(element, image.src, natural, natural * scaleRatio);
          continue;
        }
        if (size.length !== 2) {
          results.push({
            element: selector(element),
            file: image.src,
            natural: 0,
            drawn: 0,
            error: 'background size cannot be measured reliably',
          });
          continue;
        }
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
        add(element, image.src, natural, (width / height) * scaleRatio);
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
    if (
      requireReports &&
      !gm?.imageDraws &&
      [...document.querySelectorAll('canvas')].some((canvas) => {
        const rect = canvas.getBoundingClientRect();
        for (let node: HTMLElement | null = canvas; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.visibility !== 'visible' || style.display === 'none' || Number(style.opacity) === 0) return false;
        }
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.right > 0 &&
          rect.bottom > 0 &&
          rect.left < innerWidth &&
          rect.top < innerHeight
        );
      })
    )
      results.push({
        element: 'canvas',
        file: '',
        natural: 0,
        drawn: 0,
        error: 'SDK sprite reports unavailable; capture an instrumented draft build',
      });
    for (const sprite of gm?.imageDraws?.() ?? []) {
      const natural = sprite.source.width / sprite.source.height;
      const drawn = sprite.drawn.width / sprite.drawn.height;
      if (
        Math.max(sprite.drawn.width, sprite.drawn.height) >= 24 &&
        Number.isFinite(natural) &&
        natural > 0 &&
        Number.isFinite(drawn) &&
        Math.abs(drawn / natural - 1) > 0.02 + 1e-9
      )
        results.push({ element: sprite.id, file: sprite.file, natural, drawn });
    }
    return results;
  }, requireSpriteReports);
  return findings.map((item) => ({ ...item, viewport, screen }));
}
