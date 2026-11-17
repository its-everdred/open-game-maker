/** Runs inside the game frame. Coordinates are CSS pixels relative to that frame. */
export function inspectPlayArea(hostBoard: { left: number; top: number; width: number; height: number } | null) {
  const board = document.querySelector<HTMLElement>(hostBoard ? '.game-frame iframe' : '[data-gm-play-area]');
  if (!board) return { inactive: 'not declared' as const };
  const rect = hostBoard
    ? { ...hostBoard, right: hostBoard.left + hostBoard.width, bottom: hostBoard.top + hostBoard.height }
    : board.getBoundingClientRect();
  for (let element: HTMLElement | null = board; element; element = element.parentElement) {
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0)
      return { inactive: 'play area is hidden' as const };
    if (element !== board) {
      const bounds = element.getBoundingClientRect();
      if (
        (['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowX) &&
          (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)) ||
        (['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowY) &&
          (rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1))
      )
        throw new Error('play area is clipped by an ancestor');
    }
  }
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  document.body.appendChild(probe);
  const style = getComputedStyle(probe);
  const safe = {
    top: parseFloat(style.paddingTop),
    right: parseFloat(style.paddingRight),
    bottom: parseFloat(style.paddingBottom),
    left: parseFloat(style.paddingLeft),
  };
  probe.remove();
  if (
    rect.left < safe.left ||
    rect.top < safe.top ||
    rect.right > innerWidth - safe.right ||
    rect.bottom > innerHeight - safe.bottom
  )
    throw new Error('play area is clipped by viewport or safe area');

  const intersects = (box: { left: number; top: number; width: number; height: number }) =>
    box.width > 0 &&
    box.height > 0 &&
    box.left < rect.right &&
    box.left + box.width > rect.left &&
    box.top < rect.bottom &&
    box.top + box.height > rect.top;
  const overlaps: string[] = [];
  for (const element of document.querySelectorAll<HTMLElement>('body *')) {
    if (
      element === board ||
      board.contains(element) ||
      element.contains(board) ||
      element.closest('[data-gm-overlay-allowed]')
    )
      continue;
    if (element instanceof HTMLScriptElement || element instanceof HTMLStyleElement) continue;
    const bounds = element.getBoundingClientRect();
    let left = bounds.left,
      right = bounds.right,
      top = bounds.top,
      bottom = bounds.bottom;
    const pseudoPainted = ['::before', '::after'].some((pseudo) => {
      const style = getComputedStyle(element, pseudo);
      const hasPaint =
        !['none', 'normal', '""', "''", '" "', "' '"].includes(style.content) ||
        style.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
        style.backgroundImage !== 'none' ||
        ['top', 'right', 'bottom', 'left'].some(
          (side) => parseFloat(style.getPropertyValue(`border-${side}-width`)) > 0,
        );
      return (
        hasPaint &&
        style.content !== 'none' &&
        style.content !== 'normal' &&
        style.display !== 'none' &&
        style.visibility === 'visible' &&
        Number(style.opacity) !== 0
      );
    });
    if (pseudoPainted) {
      for (const name of ['::before', '::after']) {
        const style = getComputedStyle(element, name);
        if (
          style.content === 'none' ||
          style.content === 'normal' ||
          !['absolute', 'fixed', 'relative', 'static'].includes(style.position)
        )
          continue;
        let container: HTMLElement | null = style.position === 'fixed' ? null : element;
        while (
          container &&
          !['relative', 'static'].includes(style.position) &&
          getComputedStyle(container).position === 'static'
        )
          container = container.parentElement;
        const origin = container?.getBoundingClientRect();
        const width =
            ['relative', 'static'].includes(style.position) && style.width === 'auto'
              ? bounds.width
              : parseFloat(style.width),
          height =
            ['relative', 'static'].includes(style.position) && style.height === 'auto'
              ? bounds.height
              : parseFloat(style.height);
        const x = ['relative', 'static'].includes(style.position) && style.left === 'auto' ? 0 : parseFloat(style.left),
          y = ['relative', 'static'].includes(style.position) && style.top === 'auto' ? 0 : parseFloat(style.top);
        const hasTransform = (css: CSSStyleDeclaration) =>
          css.transform !== 'none' || css.translate !== 'none' || css.rotate !== 'none' || css.scale !== 'none';
        let transformed = hasTransform(style);
        for (let parent: HTMLElement | null = element; parent && !transformed; parent = parent.parentElement)
          transformed = hasTransform(getComputedStyle(parent));
        // Unknown positioned pseudo-element geometry must not silently pass the gate.
        if (transformed || [width, height, x, y].some((value) => !Number.isFinite(value))) {
          left = Math.min(left, rect.left);
          right = Math.max(right, rect.right);
          top = Math.min(top, rect.top);
          bottom = Math.max(bottom, rect.bottom);
        } else {
          const px = (origin?.left ?? 0) + x,
            py = (origin?.top ?? 0) + y;
          left = Math.min(left, px);
          right = Math.max(right, px + width);
          top = Math.min(top, py);
          bottom = Math.max(bottom, py + height);
        }
      }
    }
    let visible = true;
    for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
      const css = getComputedStyle(parent);
      if (css.display === 'none' || css.visibility !== 'visible' || Number(css.opacity) === 0) {
        visible = false;
        break;
      }
      if (parent !== element) {
        const clip = parent.getBoundingClientRect();
        if (['hidden', 'clip', 'scroll', 'auto'].includes(css.overflowX)) {
          left = Math.max(left, clip.left);
          right = Math.min(right, clip.right);
        }
        if (['hidden', 'clip', 'scroll', 'auto'].includes(css.overflowY)) {
          top = Math.max(top, clip.top);
          bottom = Math.min(bottom, clip.bottom);
        }
      }
    }
    if (!visible || !intersects({ left, top, width: right - left, height: bottom - top })) continue;
    // Skip only a candidate entirely covered by a single, fully opaque rectangular element.
    // Making the candidate hittable temporarily also handles pointer-events:none HUDs.
    const x0 = Math.max(left, rect.left),
      x1 = Math.min(right, rect.right);
    const y0 = Math.max(top, rect.top),
      y1 = Math.min(bottom, rect.bottom);
    const previousPointer = element.style.pointerEvents;
    const priority = element.style.getPropertyPriority('pointer-events');
    element.style.setProperty('pointer-events', 'auto', 'important');
    const opaqueCanvases = [...document.querySelectorAll<HTMLCanvasElement>('canvas[data-gm-opaque]')]
      .filter((canvas) => canvas !== element)
      .map((canvas) => ({
        canvas,
        pointer: canvas.style.pointerEvents,
        priority: canvas.style.getPropertyPriority('pointer-events'),
      }));
    for (const item of opaqueCanvases) item.canvas.style.setProperty('pointer-events', 'auto', 'important');
    const cover = document.elementFromPoint((x0 + x1) / 2, (y0 + y1) / 2);
    for (const item of opaqueCanvases) {
      if (item.pointer) item.canvas.style.setProperty('pointer-events', item.pointer, item.priority);
      else item.canvas.style.removeProperty('pointer-events');
    }
    if (previousPointer) element.style.setProperty('pointer-events', previousPointer, priority);
    else element.style.removeProperty('pointer-events');
    if (cover instanceof HTMLElement && cover !== element && !element.contains(cover)) {
      const coverStyle = getComputedStyle(cover);
      const coverBounds = cover.getBoundingClientRect();
      let opaque =
        (/^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/.test(coverStyle.backgroundColor) ||
          (cover instanceof HTMLCanvasElement && cover.hasAttribute('data-gm-opaque'))) &&
        coverStyle.borderRadius === '0px' &&
        coverStyle.transform === 'none' &&
        coverStyle.translate === 'none' &&
        coverStyle.rotate === 'none' &&
        coverStyle.scale === 'none' &&
        coverStyle.clipPath === 'none' &&
        coverStyle.backgroundClip === 'border-box';
      for (let parent: HTMLElement | null = cover; parent && opaque; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (
          Number(style.opacity) !== 1 ||
          style.clipPath !== 'none' ||
          style.transform !== 'none' ||
          style.translate !== 'none' ||
          style.rotate !== 'none' ||
          style.scale !== 'none' ||
          style.maskImage !== 'none' ||
          style.getPropertyValue('-webkit-mask-image') !== 'none' ||
          style.filter !== 'none' ||
          style.mixBlendMode !== 'normal'
        )
          opaque = false;
        if (
          parent !== cover &&
          (['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowX) ||
            ['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowY))
        ) {
          const bounds = parent.getBoundingClientRect();
          if (
            style.borderRadius !== '0px' ||
            bounds.left > x0 ||
            bounds.right < x1 ||
            bounds.top > y0 ||
            bounds.bottom < y1
          )
            opaque = false;
        }
      }
      if (
        opaque &&
        coverBounds.left <= x0 &&
        coverBounds.right >= x1 &&
        coverBounds.top <= y0 &&
        coverBounds.bottom >= y1
      )
        continue;
    }
    const css = getComputedStyle(element);
    const painted =
      pseudoPainted ||
      [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) ||
      css.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
      css.backgroundImage !== 'none' ||
      element instanceof SVGElement ||
      ['CANVAS', 'IMG', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'VIDEO'].includes(element.tagName) ||
      ['Top', 'Right', 'Bottom', 'Left'].some(
        (side) => parseFloat(css.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0,
      );
    if (painted)
      overlaps.push(
        element.id
          ? `#${element.id}`
          : element.getAttribute('aria-label') ||
              `${element.tagName.toLowerCase()}${typeof element.className === 'string' && element.className.trim() ? `.${element.className.trim().split(/\s+/).join('.')}` : ''}`,
      );
  }
  const report = hostBoard
    ? undefined
    : (
        window as unknown as {
          __gmUiSprites?: () => {
            name: string;
            left: number;
            top: number;
            width: number;
            height: number;
            overlayAllowed?: boolean;
          }[];
        }
      ).__gmUiSprites;
  for (const sprite of report?.() ?? []) {
    if (
      !sprite.name ||
      [sprite.left, sprite.top, sprite.width, sprite.height].some((value) => !Number.isFinite(value)) ||
      sprite.width < 0 ||
      sprite.height < 0
    )
      throw new Error('invalid UI sprite bounds');
    if (!sprite.overlayAllowed && intersects(sprite)) overlaps.push(sprite.name);
  }
  if (overlaps.length) throw new Error(`overlap: ${[...new Set(overlaps)].join(', ')}`);
  return {
    viewport: { width: innerWidth, height: innerHeight },
    board: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    safe,
    controls: { top: Number(board.dataset.gmControlTop ?? 0), bottom: Number(board.dataset.gmControlBottom ?? 0) },
    aspect: board.dataset.gmPlayAreaAspect === undefined ? undefined : Number(board.dataset.gmPlayAreaAspect),
  };
}
