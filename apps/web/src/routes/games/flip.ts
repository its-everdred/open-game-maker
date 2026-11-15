const glides = new Set<Animation>();

function track(animation: Animation): void {
  if (!animation?.finished) return;
  glides.add(animation);
  void animation.finished.catch(() => undefined).finally(() => glides.delete(animation));
}

export function cancelGlides(): void {
  for (const animation of glides) animation.cancel();
  glides.clear();
}

export function fitExitingLayers(container: HTMLElement): void {
  for (const layer of container.querySelectorAll<HTMLElement>('.game-cell-exiting')) {
    const cell = layer.parentElement;
    const oldWidth = Number.parseFloat(layer.style.width);
    const oldHeight = Number.parseFloat(layer.style.height);
    if (!cell || !oldWidth || !oldHeight) continue;
    const next = cell.getBoundingClientRect();
    layer.style.transform = `scale(${next.width / oldWidth}, ${next.height / oldHeight})`;
  }
}

export type TileRects = Map<string, DOMRect>;

export function measureTiles(container: HTMLElement | null): TileRects {
  return new Map(
    [...(container?.querySelectorAll<HTMLElement>('[data-game-id]') ?? [])].map((tile) => [
      tile.dataset.gameId!,
      tile.getBoundingClientRect(),
    ]),
  );
}

export function glideTiles(container: HTMLElement | null, before: TileRects): void {
  if (!container || before.size === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  for (const tile of container.querySelectorAll<HTMLElement>('[data-game-id]')) {
    const old = before.get(tile.dataset.gameId!);
    if (!old) continue;
    const next = tile.getBoundingClientRect();
    const dx = old.left - next.left;
    const dy = old.top - next.top;
    const sx = next.width ? old.width / next.width : 1;
    const sy = next.height ? old.height / next.height : 1;
    const phoneOpening = tile.classList.contains('is-selected') && window.matchMedia('(max-width: 600px)').matches;
    if (
      (dx === 0 && dy === 0 && sx === 1 && sy === 1) ||
      (next.bottom < 0 && old.bottom < 0) ||
      (next.top > window.innerHeight && old.top > window.innerHeight) ||
      !tile.animate
    )
      continue;
    // Keep the incoming details legible while the cell changes aspect ratio.
    const copy = tile.classList.contains('is-selected')
      ? tile.querySelector<HTMLElement>('.game-cell-spotlight .games-spotlight-copy')
      : null;
    if (copy?.animate && (sx !== 1 || sy !== 1) && phoneOpening) {
      track(
        copy.animate([{ opacity: 0 }, { opacity: 0, offset: 0.8 }, { opacity: 1 }], {
          duration: 300,
          easing: 'cubic-bezier(.22,1,.36,1)',
        }),
      );
    }
    track(
      tile.animate(
        [
          {
            transformOrigin: 'top left',
            transform: `translate(${dx}px, ${dy}px) scale(${phoneOpening ? 1 : sx}, ${phoneOpening ? 1 : sy})`,
          },
          { transformOrigin: 'top left', transform: 'none' },
        ],
        {
          duration: 300,
          easing: 'cubic-bezier(.22,1,.36,1)',
        },
      ),
    );
  }
}

export type CoverRect = { id: string; rect: DOMRect };

export function measureCovers(container: HTMLElement | null): Map<string, CoverRect> {
  const covers = new Map<string, CoverRect>();
  for (const cell of container?.querySelectorAll<HTMLElement>('[data-game-id]') ?? []) {
    const host = cell.querySelector<HTMLElement>('.game-cover-host');
    const id = cell.dataset.gameId;
    if (host && id) covers.set(id, { id, rect: host.getBoundingClientRect() });
  }
  return covers;
}

// Counter the cell's FLIP so the same cover starts at its own old rectangle.
export function glideCover(container: HTMLElement, before: TileRects, cover: CoverRect | null): void {
  if (!cover || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cell = [...container.querySelectorAll<HTMLElement>('[data-game-id]')].find(
    (item) => item.dataset.gameId === cover.id,
  );
  const host = cell?.querySelector<HTMLElement>('.game-cover-host');
  const oldCell = before.get(cover.id);
  if (!cell || !host || !oldCell || !host.animate) return;
  const nextCell = cell.getBoundingClientRect();
  const nextCover = host.getBoundingClientRect();
  if (!nextCell.width || !nextCell.height || !nextCover.width || !nextCover.height || !oldCell.width || !oldCell.height)
    return;
  // Phone cells move at their final size; only the cover changes size.
  const phoneOpening = cell.classList.contains('is-selected') && window.matchMedia('(max-width: 600px)').matches;
  const sx = phoneOpening ? 1 : oldCell.width / nextCell.width;
  const sy = phoneOpening ? 1 : oldCell.height / nextCell.height;
  const dx = (cover.rect.left - oldCell.left) / sx - (nextCover.left - nextCell.left);
  const dy = (cover.rect.top - oldCell.top) / sy - (nextCover.top - nextCell.top);
  const xScale = cover.rect.width / sx / nextCover.width;
  const yScale = cover.rect.height / sy / nextCover.height;
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01 && Math.abs(xScale - 1) < 0.0001 && Math.abs(yScale - 1) < 0.0001)
    return;
  const options: KeyframeAnimationOptions = { duration: 300, easing: 'cubic-bezier(.22,1,.36,1)' };
  for (const ancestor of [host.closest('.game-cover'), host.closest('.games-spotlight-media')]) {
    if (ancestor instanceof HTMLElement && ancestor.animate) {
      track(
        ancestor.animate(
          [
            { overflow: 'visible', clipPath: 'none', maskImage: 'none', WebkitMaskImage: 'none' },
            { overflow: 'visible', clipPath: 'none', maskImage: 'none', WebkitMaskImage: 'none' },
          ],
          options,
        ),
      );
    }
  }
  track(
    host.animate(
      [
        { transformOrigin: 'top left', transform: `translate(${dx}px, ${dy}px) scale(${xScale}, ${yScale})` },
        { transformOrigin: 'top left', transform: 'none' },
      ],
      options,
    ),
  );
}
