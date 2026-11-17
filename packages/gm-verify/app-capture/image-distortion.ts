import type { Frame } from 'playwright';

/** Retain closed roots created after navigation so captures can inspect their contents. */
export function trackShadowRoots(): void {
  const roots = new WeakMap<Element, ShadowRoot>();
  (window as unknown as { __gmShadowRoots: WeakMap<Element, ShadowRoot> }).__gmShadowRoots = roots;
  const attach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (options: ShadowRootInit) {
    const root = attach.call(this, options);
    roots.set(this, root);
    return root;
  };
}

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
    const roots = (window as unknown as { __gmShadowRoots?: WeakMap<Element, ShadowRoot> }).__gmShadowRoots;
    const elements: HTMLElement[] = [];
    const collect = (root: Document | ShadowRoot) => {
      for (const element of root.querySelectorAll<HTMLElement>('*')) {
        elements.push(element);
        const shadow = element.shadowRoot ?? roots?.get(element);
        if (shadow) collect(shadow);
      }
    };
    collect(document);
    const parentOf = (element: HTMLElement): HTMLElement | null => {
      if (element.parentElement) return element.parentElement;
      const root = element.getRootNode();
      return root instanceof ShadowRoot && root.host instanceof HTMLElement ? root.host : null;
    };
    const selector = (element: Element): string => {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const parts: string[] = [];
      for (
        let node: HTMLElement | null = element as HTMLElement;
        node && node !== document.documentElement;
        node = parentOf(node)
      ) {
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
      if (!Number.isFinite(natural) || natural <= 0 || !Number.isFinite(drawn)) {
        results.push({
          element: selector(element),
          file,
          natural: 0,
          drawn: 0,
          error: 'drawn geometry cannot be measured reliably',
        });
        return;
      }
      if (Math.abs(drawn / natural - 1) > 0.02 + 1e-9)
        results.push({ element: selector(element), file, natural, drawn });
    };
    const raster = (url: string) => !/\.svg(?:[?#]|$)/i.test(url) && !/^data:image\/svg\+xml/i.test(url);
    const urls = (value: string) =>
      [...value.matchAll(/url\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^\s)]+))\s*\)/gi)].map(
        (match) => match[1] ?? match[2] ?? match[3] ?? '',
      );
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
      parent.style.setProperty('all', 'initial', 'important');
      for (const [name, setting] of Object.entries({
        display: 'block',
        position: 'fixed',
        visibility: 'hidden',
        left: '-10000px',
        width: `${extent}px`,
        height: '0',
      }))
        parent.style.setProperty(name, setting, 'important');
      const probe = document.createElement('div');
      probe.style.cssText = `all:initial;display:block;box-sizing:content-box;width:${value};padding:0;border:0;margin:0`;
      parent.attachShadow({ mode: 'open' }).append(probe);
      document.body.append(parent);
      const result = probe.getBoundingClientRect().width;
      parent.remove();
      return result;
    };
    for (const element of elements) {
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
      for (let parent = parentOf(element); parent; parent = parentOf(parent)) {
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
      for (let node: HTMLElement | null = element; node; node = parentOf(node)) {
        const computed = getComputedStyle(node);
        const matrix = computed.transform;
        if (matrix !== 'none') transform = new DOMMatrix(matrix).multiply(transform);
        if (computed.scale !== 'none') {
          const parts = computed.scale.split(/\s+/).map(Number);
          transform = new DOMMatrix().scale(parts[0]!, parts[1] ?? parts[0]!).multiply(transform);
        }
      }
      const scaleRatio = Math.hypot(transform.a, transform.b) / Math.hypot(transform.c, transform.d);
      for (const pseudo of ['::before', '::after']) {
        const generated = getComputedStyle(element, pseudo);
        if (
          generated.content === 'none' ||
          generated.content === 'normal' ||
          generated.display === 'none' ||
          generated.visibility !== 'visible' ||
          Number(generated.opacity) === 0
        )
          continue;
        const files = urls(generated.backgroundImage).filter(raster);
        const intrinsic = splitLayers(generated.backgroundSize).every((size) => {
          const parts = splitSize(size.trim());
          return parts.length === 1 || parts.includes('auto') || parts.includes('cover') || parts.includes('contain');
        });
        if (
          intrinsic &&
          generated.transform === 'none' &&
          generated.scale === 'none' &&
          Math.abs(scaleRatio - 1) <= 0.02 + 1e-9
        )
          continue;
        if (
          files.length &&
          Math.max(parseFloat(generated.width) || rect.width, parseFloat(generated.height) || rect.height) >= 24
        ) {
          const size = splitSize(generated.backgroundSize.trim());
          const width = parseFloat(generated.width);
          const height = parseFloat(generated.height);
          if (
            files.length === 1 &&
            !/image-set\(/i.test(generated.backgroundImage) &&
            size.length === 2 &&
            size.every((part) => part !== 'auto') &&
            Number.isFinite(width) &&
            width > 0 &&
            Number.isFinite(height) &&
            height > 0 &&
            generated.transform === 'none' &&
            generated.scale === 'none'
          ) {
            const image = new Image();
            image.src = files[0]!;
            await image.decode().catch(() => undefined);
            if (image.naturalWidth && image.naturalHeight) {
              const natural = image.naturalWidth / image.naturalHeight;
              const paddingX = parseFloat(generated.paddingLeft) + parseFloat(generated.paddingRight);
              const paddingY = parseFloat(generated.paddingTop) + parseFloat(generated.paddingBottom);
              const borderX = parseFloat(generated.borderLeftWidth) + parseFloat(generated.borderRightWidth);
              const borderY = parseFloat(generated.borderTopWidth) + parseFloat(generated.borderBottomWidth);
              const contentWidth = width - (generated.boxSizing === 'border-box' ? paddingX + borderX : 0);
              const contentHeight = height - (generated.boxSizing === 'border-box' ? paddingY + borderY : 0);
              const boxWidth =
                contentWidth +
                (generated.backgroundOrigin === 'content-box' ? 0 : paddingX) +
                (generated.backgroundOrigin === 'border-box' ? borderX : 0);
              const boxHeight =
                contentHeight +
                (generated.backgroundOrigin === 'content-box' ? 0 : paddingY) +
                (generated.backgroundOrigin === 'border-box' ? borderY : 0);
              const drawn = (dimension(size[0]!, boxWidth) / dimension(size[1]!, boxHeight)) * scaleRatio;
              if (Number.isFinite(drawn) && drawn > 0) {
                if (Math.abs(drawn / natural - 1) > 0.02 + 1e-9)
                  results.push({ element: `${selector(element)}${pseudo}`, file: image.src, natural, drawn });
                continue;
              }
            }
          }
          results.push({
            element: `${selector(element)}${pseudo}`,
            file: files.join(', '),
            natural: 0,
            drawn: 0,
            error: 'pseudo-element background cannot be measured reliably',
          });
        }
      }
      const paddingX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const paddingY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const borderX = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
      const borderY = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      const cssWidth = parseFloat(style.width);
      const cssHeight = parseFloat(style.height);
      const contentWidth = Number.isFinite(cssWidth)
        ? cssWidth - (style.boxSizing === 'border-box' ? paddingX + borderX : 0)
        : element.clientWidth - paddingX;
      const contentHeight = Number.isFinite(cssHeight)
        ? cssHeight - (style.boxSizing === 'border-box' ? paddingY + borderY : 0)
        : element.clientHeight - paddingY;
      if (
        element instanceof HTMLImageElement &&
        element.naturalWidth &&
        element.naturalHeight &&
        raster(element.currentSrc)
      ) {
        const width = contentWidth;
        const height = contentHeight;
        const natural = element.naturalWidth / element.naturalHeight;
        const drawn = style.objectFit === 'fill' ? width / height : natural;
        if (width > 0 && height > 0) add(element, element.currentSrc, natural, drawn * scaleRatio);
      }
      const layers = splitLayers(style.backgroundImage);
      const sizes = splitLayers(style.backgroundSize);
      const origins = splitLayers(style.backgroundOrigin);
      for (const [index, layer] of layers.entries()) {
        if (/image-set\(/i.test(layer)) {
          const candidates = urls(layer);
          if (candidates.length === 0 || candidates.some(raster))
            results.push({
              element: selector(element),
              file: layer,
              natural: 0,
              drawn: 0,
              error: 'image-set cannot be measured reliably',
            });
          continue;
        }
        const url = urls(layer)[0];
        if (!url || !raster(url)) continue;
        const size = splitSize((sizes[index] ?? sizes[0] ?? '').trim());
        const image = new Image();
        image.src = url;
        await image.decode().catch(() => undefined);
        if (!image.naturalWidth || !image.naturalHeight) {
          results.push({
            element: selector(element),
            file: url,
            natural: 0,
            drawn: 0,
            error: 'raster background could not be decoded',
          });
          continue;
        }
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
          contentWidth + (origin === 'content-box' ? 0 : paddingX) + (origin === 'border-box' ? borderX : 0);
        const boxHeight =
          contentHeight + (origin === 'content-box' ? 0 : paddingY) + (origin === 'border-box' ? borderY : 0);
        if (!Number.isFinite(boxWidth) || !Number.isFinite(boxHeight) || boxWidth <= 0 || boxHeight <= 0) {
          results.push({
            element: selector(element),
            file: image.src,
            natural: 0,
            drawn: 0,
            error: 'background geometry cannot be measured reliably',
          });
          continue;
        }
        const width = dimension(size[0]!, boxWidth);
        const height = dimension(size[1]!, boxHeight);
        if (width === 0 || height === 0) continue;
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
          imageDrawsReady?: () => boolean;
        };
      }
    ).__gm;
    if (
      requireReports &&
      (!gm?.imageDraws || !gm.imageDrawsReady?.()) &&
      elements
        .filter((element): element is HTMLCanvasElement => element instanceof HTMLCanvasElement)
        .some((canvas) => {
          const rect = canvas.getBoundingClientRect();
          for (let node: HTMLElement | null = canvas; node; node = parentOf(node)) {
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
    const reported = gm?.imageDrawsReady?.() ? gm.imageDraws?.() : [];
    if (!Array.isArray(reported))
      results.push({ element: 'canvas', file: '', natural: 0, drawn: 0, error: 'invalid SDK sprite report' });
    for (const sprite of Array.isArray(reported) ? reported : []) {
      if (
        !sprite ||
        typeof sprite.id !== 'string' ||
        !sprite.id ||
        typeof sprite.file !== 'string' ||
        !sprite.file ||
        !sprite.source ||
        !sprite.drawn ||
        [sprite.source.width, sprite.source.height, sprite.drawn.width, sprite.drawn.height].some(
          (value) => !Number.isFinite(value) || value <= 0,
        )
      ) {
        results.push({
          element: sprite?.id || 'sprite',
          file: sprite?.file || '',
          natural: 0,
          drawn: 0,
          error: 'invalid SDK sprite dimensions',
        });
        continue;
      }
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
