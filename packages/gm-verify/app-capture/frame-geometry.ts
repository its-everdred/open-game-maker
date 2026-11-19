import type { Frame } from 'playwright';

export type Linear = { a: number; b: number; c: number; d: number; unmeasurable?: boolean };
export const identity: Linear = { a: 1, b: 0, c: 0, d: 1 };

/** Compose each embedding frame's CSS transforms into the screenshot coordinate space. */
export async function frameTransform(frame: Frame): Promise<Linear> {
  let result = identity;
  for (let current: Frame | null = frame; current?.parentFrame(); current = current.parentFrame()) {
    const owner = await current.frameElement();
    const outer = await owner.evaluate((element) => {
      let matrix = new DOMMatrix();
      let unmeasurable = false;
      for (let node: HTMLElement | null = element as HTMLElement; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.transform !== 'none') {
          const next = new DOMMatrix(style.transform);
          if (!next.is2D) unmeasurable = true;
          matrix = next.multiply(matrix);
        }
        if (style.perspective !== 'none' || /\s/.test(style.rotate)) unmeasurable = true;
        if (style.scale !== 'none') {
          const parts = style.scale.split(/\s+/).map((part) => parseFloat(part) / (part.endsWith('%') ? 100 : 1));
          if (parts.length > 2 || parts.some((part) => !Number.isFinite(part))) unmeasurable = true;
          else matrix = new DOMMatrix().scale(parts[0]!, parts[1] ?? parts[0]!).multiply(matrix);
        }
        if (style.rotate !== 'none' && !/\s/.test(style.rotate)) {
          const angle =
            parseFloat(style.rotate) *
            (style.rotate.endsWith('turn') ? 360 : style.rotate.endsWith('rad') ? 180 / Math.PI : 1);
          matrix = new DOMMatrix().rotate(angle).multiply(matrix);
        }
      }
      return { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, unmeasurable };
    });
    result = {
      a: outer.a * result.a + outer.c * result.b,
      b: outer.b * result.a + outer.d * result.b,
      c: outer.a * result.c + outer.c * result.d,
      d: outer.b * result.c + outer.d * result.d,
      unmeasurable: outer.unmeasurable || result.unmeasurable,
    };
  }
  return result;
}

export async function frameCovered(frame: Frame): Promise<boolean> {
  for (let current: Frame | null = frame; current?.parentFrame(); current = current.parentFrame()) {
    const owner = await current.frameElement();
    const covered = await owner.evaluate((element) => {
      if (!(element instanceof Element)) return false;
      const rect = element.getBoundingClientRect();
      const root = element.getRootNode();
      if (!(root instanceof Document || root instanceof ShadowRoot)) return false;
      const points = [
        [rect.left + 0.5, rect.top + 0.5],
        [rect.right - 0.5, rect.top + 0.5],
        [rect.left + 0.5, rect.bottom - 0.5],
        [rect.right - 0.5, rect.bottom - 0.5],
        [(rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2],
      ];
      const hit = root.elementFromPoint(points[4]![0]!, points[4]![1]!);
      if (!hit || hit === element || hit.contains(element)) return false;
      for (let overlay: Element | null = hit; overlay; overlay = overlay.parentElement) {
        const style = getComputedStyle(overlay);
        const box = overlay.getBoundingClientRect();
        const opaque =
          /^rgb\(/.test(style.backgroundColor) || /^rgba\([^)]*,\s*1(?:\.0+)?\s*\)$/.test(style.backgroundColor);
        if (
          !opaque ||
          box.left > rect.left ||
          box.top > rect.top ||
          box.right < rect.right ||
          box.bottom < rect.bottom ||
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
          const bounds = parent.getBoundingClientRect();
          if (
            ancestor.opacity !== '1' ||
            ancestor.filter !== 'none' ||
            ancestor.clipPath !== 'none' ||
            (['hidden', 'clip', 'auto', 'scroll'].includes(ancestor.overflowX) &&
              (bounds.left > rect.left || bounds.right < rect.right)) ||
            (['hidden', 'clip', 'auto', 'scroll'].includes(ancestor.overflowY) &&
              (bounds.top > rect.top || bounds.bottom < rect.bottom))
          ) {
            solid = false;
            break;
          }
        }
        if (
          solid &&
          points.every(([x, y]) => {
            const top = root.elementFromPoint(x!, y!);
            return top === overlay || (top !== null && overlay.contains(top));
          })
        )
          return true;
      }
      return false;
    });
    if (covered) return true;
  }
  return false;
}
