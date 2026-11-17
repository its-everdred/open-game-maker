import type { Frame } from 'playwright';
import { identity, type Linear } from './frame-geometry';

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
  outer: Linear = identity,
): Promise<ImageDistortion[]> {
  const findings = await frame.evaluate(
    async ({ requireReports, outer }) => {
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
        const root = element.getRootNode();
        const prefix = root instanceof ShadowRoot ? `${selector(root.host)} >>> ` : '';
        if (
          element.id &&
          (root instanceof Document || root instanceof ShadowRoot) &&
          root.querySelectorAll(`#${CSS.escape(element.id)}`).length === 1
        )
          return `${prefix}#${CSS.escape(element.id)}`;
        const parts: string[] = [];
        for (
          let node: HTMLElement | null = element as HTMLElement;
          node && node !== document.documentElement && node.getRootNode() === root;
          node = node.parentElement
        ) {
          const siblings = node.parentElement
            ? Array.from(node.parentElement.children).filter((s) => s.tagName === node!.tagName)
            : [];
          parts.unshift(
            `${node.tagName.toLowerCase()}${siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(node) + 1})` : ''}`,
          );
        }
        return prefix + parts.join(' > ');
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
        (window as unknown as { __gmIgnoreCaptureProbe?: (node: Node) => void }).__gmIgnoreCaptureProbe?.(parent);
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
      const covered = (element: HTMLElement, rect: DOMRect): boolean => {
        const root = element.getRootNode();
        if (!(root instanceof Document || root instanceof ShadowRoot)) return false;
        if (root instanceof ShadowRoot && root.host instanceof HTMLElement && covered(root.host, rect)) return true;
        const points = [
          [rect.left + 0.5, rect.top + 0.5],
          [rect.right - 0.5, rect.top + 0.5],
          [rect.left + 0.5, rect.bottom - 0.5],
          [rect.right - 0.5, rect.bottom - 0.5],
          [(rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2],
        ];
        const hit = root.elementFromPoint(points[4]![0]!, points[4]![1]!);
        if (!hit || hit === element || hit.contains(element)) return false;
        for (let overlay: Element | null = hit; overlay && overlay !== element; overlay = overlay.parentElement) {
          const style = getComputedStyle(overlay);
          const bounds = overlay.getBoundingClientRect();
          const opaque =
            /^rgb\(/.test(style.backgroundColor) || /^rgba\([^)]*,\s*1(?:\.0+)?\s*\)$/.test(style.backgroundColor);
          if (
            !opaque ||
            bounds.left > rect.left ||
            bounds.top > rect.top ||
            bounds.right < rect.right ||
            bounds.bottom < rect.bottom ||
            style.opacity !== '1' ||
            style.transform !== 'none' ||
            style.clipPath !== 'none' ||
            style.borderRadius !== '0px' ||
            style.backgroundClip !== 'border-box' ||
            style.filter !== 'none' ||
            style.maskImage !== 'none' ||
            style.mixBlendMode !== 'normal'
          )
            continue;
          let solid = true;
          for (let parent = overlay.parentElement; parent; parent = parent.parentElement) {
            const ancestor = getComputedStyle(parent);
            const box = parent.getBoundingClientRect();
            if (
              ancestor.opacity !== '1' ||
              ancestor.filter !== 'none' ||
              ancestor.clipPath !== 'none' ||
              (['hidden', 'clip', 'auto', 'scroll'].includes(ancestor.overflowX) &&
                (box.left > rect.left || box.right < rect.right)) ||
              (['hidden', 'clip', 'auto', 'scroll'].includes(ancestor.overflowY) &&
                (box.top > rect.top || box.bottom < rect.bottom))
            ) {
              solid = false;
              break;
            }
          }
          if (!solid) continue;
          if (
            points.every(([x, y]) => {
              const top = root.elementFromPoint(x!, y!);
              return top === overlay || (top !== null && overlay.contains(top));
            })
          )
            return true;
        }
        return false;
      };
      const visibleElements = new Set<HTMLElement>();
      const canvasGeometry = new Map<
        HTMLCanvasElement,
        { width: number; height: number; a: number; b: number; c: number; d: number; unmeasurable: boolean }
      >();
      for (const element of elements) {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (style.display === 'none' || Number(style.opacity) === 0) continue;
        let hidden = false;
        let visible = {
          left: Math.max(0, rect.left),
          top: Math.max(0, rect.top),
          right: Math.min(innerWidth, rect.right),
          bottom: Math.min(innerHeight, rect.bottom),
        };
        for (let parent = parentOf(element); parent; parent = parentOf(parent)) {
          const ancestor = getComputedStyle(parent);
          if (ancestor.display === 'none' || Number(ancestor.opacity) === 0) {
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
        if (hidden) continue;
        const obscured = covered(element, rect);
        if (obscured && covered(element, new DOMRect(0, 0, innerWidth, innerHeight))) continue;
        const hostVisible =
          style.visibility === 'visible' &&
          rect.right > 0 &&
          rect.bottom > 0 &&
          rect.left < innerWidth &&
          rect.top < innerHeight &&
          visible.left < visible.right &&
          visible.top < visible.bottom &&
          !obscured;
        const displayedSize = Math.max(
          Math.abs(outer.a) * rect.width + Math.abs(outer.c) * rect.height,
          Math.abs(outer.b) * rect.width + Math.abs(outer.d) * rect.height,
        );
        if (hostVisible && displayedSize >= 24) visibleElements.add(element);
        let transform = new DOMMatrix();
        let unmeasurableTransform = outer.unmeasurable === true;
        for (let node: HTMLElement | null = element; node; node = parentOf(node)) {
          const computed = getComputedStyle(node);
          const matrix = computed.transform;
          if (matrix !== 'none') {
            const next = new DOMMatrix(matrix);
            if (!next.is2D) unmeasurableTransform = true;
            transform = next.multiply(transform);
          }
          if (computed.perspective !== 'none' || /\s/.test(computed.rotate)) unmeasurableTransform = true;
          if (computed.scale !== 'none') {
            const parts = computed.scale.split(/\s+/).map((part) => parseFloat(part) / (part.endsWith('%') ? 100 : 1));
            if (parts.length > 2 || parts.some((part) => !Number.isFinite(part))) unmeasurableTransform = true;
            else transform = new DOMMatrix().scale(parts[0]!, parts[1] ?? parts[0]!).multiply(transform);
          }
          if (computed.rotate !== 'none' && !/\s/.test(computed.rotate)) {
            const angle =
              parseFloat(computed.rotate) *
              (computed.rotate.endsWith('turn') ? 360 : computed.rotate.endsWith('rad') ? 180 / Math.PI : 1);
            transform = new DOMMatrix().rotate(angle).multiply(transform);
          }
        }
        transform = new DOMMatrix([outer.a, outer.b, outer.c, outer.d, 0, 0]).multiply(transform);
        const scaleRatio = Math.hypot(transform.a, transform.b) / Math.hypot(transform.c, transform.d);
        if (
          unmeasurableTransform &&
          (element instanceof HTMLImageElement || urls(style.backgroundImage).some(raster))
        ) {
          results.push({
            element: selector(element),
            file: element instanceof HTMLImageElement ? element.currentSrc : style.backgroundImage,
            natural: 0,
            drawn: 0,
            error: '3D transform cannot be measured reliably',
          });
          continue;
        }
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
          if (generated.position === 'static' && generated.transform === 'none') {
            const width = parseFloat(generated.width) || 0;
            const height = parseFloat(generated.height) || 0;
            if (
              rect.right + width <= 0 ||
              rect.bottom + height <= 0 ||
              rect.left - width >= innerWidth ||
              rect.top - height >= innerHeight
            )
              continue;
          }
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
        if (!hostVisible || displayedSize < 24) continue;
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
        if (element instanceof HTMLCanvasElement)
          canvasGeometry.set(element, {
            width: contentWidth,
            height: contentHeight,
            a: transform.a,
            b: transform.b,
            c: transform.c,
            d: transform.d,
            unmeasurable: unmeasurableTransform,
          });
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
        const attachments = splitLayers(style.backgroundAttachment);
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
          let boxWidth =
            contentWidth + (origin === 'content-box' ? 0 : paddingX) + (origin === 'border-box' ? borderX : 0);
          let boxHeight =
            contentHeight + (origin === 'content-box' ? 0 : paddingY) + (origin === 'border-box' ? borderY : 0);
          if ((attachments[index] ?? attachments[0])?.trim() === 'fixed') {
            if (transform.isIdentity) {
              boxWidth = innerWidth;
              boxHeight = innerHeight;
            } else {
              results.push({
                element: selector(element),
                file: image.src,
                natural: 0,
                drawn: 0,
                error: 'fixed background under a transform cannot be measured reliably',
              });
              continue;
            }
          }
          if (!Number.isFinite(boxWidth) || !Number.isFinite(boxHeight) || boxWidth <= 0 || boxHeight <= 0) {
            if (size.every((part) => !part.includes('%'))) {
              boxWidth = 1;
              boxHeight = 1;
            } else {
              results.push({
                element: selector(element),
                file: image.src,
                natural: 0,
                drawn: 0,
                error: 'background geometry cannot be measured reliably',
              });
              continue;
            }
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
              canvasId?: string;
              source: { width: number; height: number };
              drawn: { width: number; height: number };
            }[];
            imageDrawsReady?: () => boolean;
          };
        }
      ).__gm;
      const draws =
        (
          window as unknown as {
            __gmCanvasDraws?: () => {
              canvas: HTMLCanvasElement;
              file: string;
              sourceWidth: number;
              sourceHeight: number;
              drawnWidth: number;
              drawnHeight: number;
              a: number;
              b: number;
              c: number;
              d: number;
            }[];
          }
        ).__gmCanvasDraws?.() ?? [];
      for (const draw of draws) {
        const geometry = canvasGeometry.get(draw.canvas);
        if (!geometry || !visibleElements.has(draw.canvas) || !raster(draw.file)) continue;
        if (geometry.unmeasurable) {
          results.push({
            element: selector(draw.canvas),
            file: draw.file,
            natural: 0,
            drawn: 0,
            error: '3D canvas transform cannot be measured reliably',
          });
          continue;
        }
        const scaleX = geometry.width / draw.canvas.width;
        const scaleY = geometry.height / draw.canvas.height;
        const natural = draw.sourceWidth / draw.sourceHeight;
        const a = geometry.a * scaleX * draw.a + geometry.c * scaleY * draw.b;
        const b = geometry.b * scaleX * draw.a + geometry.d * scaleY * draw.b;
        const c = geometry.a * scaleX * draw.c + geometry.c * scaleY * draw.d;
        const d = geometry.b * scaleX * draw.c + geometry.d * scaleY * draw.d;
        const drawn = (Math.abs(draw.drawnWidth / draw.drawnHeight) * Math.hypot(a, b)) / Math.hypot(c, d);
        if (![natural, drawn, scaleX, scaleY].every((value) => Number.isFinite(value) && value > 0))
          results.push({
            element: selector(draw.canvas),
            file: draw.file,
            natural: 0,
            drawn: 0,
            error: 'canvas draw geometry cannot be measured reliably',
          });
        else if (
          Math.max(Math.abs(draw.drawnWidth) * Math.hypot(a, b), Math.abs(draw.drawnHeight) * Math.hypot(c, d)) >= 24 &&
          Math.abs(drawn / natural - 1) > 0.02 + 1e-9
        )
          results.push({ element: selector(draw.canvas), file: draw.file, natural, drawn });
      }
      if (
        requireReports &&
        (!gm?.imageDraws || !gm.imageDrawsReady?.()) &&
        elements
          .filter((element): element is HTMLCanvasElement => element instanceof HTMLCanvasElement)
          .some(
            (canvas) =>
              visibleElements.has(canvas) &&
              canvas.dataset.gmWorldCanvas !== 'true' &&
              !draws.some((draw) => draw.canvas === canvas),
          )
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
      const webgl =
        (window as unknown as { __gmWebglCanvases?: () => HTMLCanvasElement[] }).__gmWebglCanvases?.() ?? [];
      const patterned =
        (window as unknown as { __gmPatternedCanvases?: () => HTMLCanvasElement[] }).__gmPatternedCanvases?.() ?? [];
      if (patterned.some((canvas) => visibleElements.has(canvas) && canvas.dataset.gmWorldCanvas !== 'true'))
        results.push({
          element: 'canvas',
          file: '',
          natural: 0,
          drawn: 0,
          error: 'canvas pattern rendering cannot be verified',
        });
      const transferred =
        (window as unknown as { __gmTransferredCanvases?: () => HTMLCanvasElement[] }).__gmTransferredCanvases?.() ??
        [];
      if (transferred.some((canvas) => visibleElements.has(canvas) && canvas.dataset.gmWorldCanvas !== 'true'))
        results.push({
          element: 'canvas',
          file: '',
          natural: 0,
          drawn: 0,
          error: 'worker canvas rendering cannot be verified',
        });
      const uiWebgl = webgl.filter((canvas) => visibleElements.has(canvas) && canvas.dataset.gmWorldCanvas !== 'true');
      const stats = (
        window as unknown as {
          __gmWebglDraws?: () => { canvas: HTMLCanvasElement; count: number; unsupported: boolean }[];
        }
      ).__gmWebglDraws?.();
      const uiStats = stats?.filter((entry) => uiWebgl.includes(entry.canvas)) ?? [];
      if (
        uiWebgl.length > 0 &&
        (!stats ||
          uiStats.some((entry) => entry.unsupported) ||
          !Array.isArray(reported) ||
          uiStats.some(
            (entry) =>
              !entry.canvas.id ||
              document.getElementById(entry.canvas.id) !== entry.canvas ||
              reported.filter((sprite) => sprite?.canvasId === entry.canvas.id).length !== entry.count,
          ))
      )
        results.push({
          element: 'canvas',
          file: '',
          natural: 0,
          drawn: 0,
          error: 'WebGL UI coverage is unverified; use one reported sprite per draw or mark a world-only canvas',
        });
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
        if (outer.unmeasurable) {
          results.push({
            element: sprite.id,
            file: sprite.file,
            natural: 0,
            drawn: 0,
            error: '3D frame transform cannot be measured reliably',
          });
          continue;
        }
        const drawn =
          ((sprite.drawn.width / sprite.drawn.height) * Math.hypot(outer.a, outer.b)) / Math.hypot(outer.c, outer.d);
        if (!Number.isFinite(drawn)) {
          results.push({
            element: sprite.id,
            file: sprite.file,
            natural: 0,
            drawn: 0,
            error: 'sprite transform cannot be measured reliably',
          });
          continue;
        }
        if (
          Math.max(
            Math.abs(outer.a) * sprite.drawn.width + Math.abs(outer.c) * sprite.drawn.height,
            Math.abs(outer.b) * sprite.drawn.width + Math.abs(outer.d) * sprite.drawn.height,
          ) >= 24 &&
          Number.isFinite(natural) &&
          natural > 0 &&
          Number.isFinite(drawn) &&
          Math.abs(drawn / natural - 1) > 0.02 + 1e-9
        )
          results.push({ element: sprite.id, file: sprite.file, natural, drawn });
      }
      return results;
    },
    { requireReports: requireSpriteReports, outer },
  );
  return findings.map((item) => ({ ...item, viewport, screen }));
}
