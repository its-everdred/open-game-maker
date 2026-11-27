import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { SceneDoc } from '@ogm/contracts/browser';

import { parseCell, tileLayersFrontToBack, type Cell, type TileRef } from './edit';
import type { MapPack, Point, SceneDrawPiece, Sprites } from './pack';
import { spriteBounds, spritePixelAt } from './sprite-geometry';

/** Map pixel → screen pixel: `screen = map * scale + offset`. */
type View = { scale: number; x: number; y: number };
export type MapPointer = { point: Point; cell?: Cell; pick?: TileRef };
/** What a press starts: a drag the editor follows, or a pan of the map. */
export type PressResult = 'drag' | 'pan';

const images = new Map<string, HTMLImageElement>();
const alphas = new Map<string, { width: number; height: number; data: Uint8ClampedArray } | null>();

function image(url: string, onLoad: () => void): HTMLImageElement | undefined {
  let found = images.get(url);
  if (!found) {
    found = new Image();
    found.decoding = 'async';
    found.src = url;
    images.set(url, found);
  }
  if (found.complete && found.naturalWidth > 0) return found;
  found.addEventListener('load', onLoad, { once: true });
  return undefined;
}

function alphaOf(url: string, img: HTMLImageElement) {
  let alpha = alphas.get(url);
  if (alpha === undefined) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context?.drawImage(img, 0, 0);
      const data = context?.getImageData(0, 0, canvas.width, canvas.height).data;
      alpha = data ? { width: canvas.width, height: canvas.height, data } : null;
    } catch {
      alpha = null;
    }
    alphas.set(url, alpha);
  }
  return alpha;
}

/** Whether a piece's image is solid at a pixel, so a tap picks the tree you see, not the cell behind it. */
function solidAt(url: string, img: HTMLImageElement, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= img.naturalWidth || y >= img.naturalHeight) return false;
  const alpha = alphaOf(url, img);
  /* Without pixels (a test canvas), the image's box stands in. */
  if (!alpha) return true;
  return alpha.data[(Math.floor(y) * alpha.width + Math.floor(x)) * 4 + 3]! > 40;
}

/** The first row of an image with any solid pixel: the top of what the player sees. */
function solidTop(url: string, img: HTMLImageElement): number {
  const alpha = alphaOf(url, img);
  if (!alpha) return 0;
  for (let y = 0; y < alpha.height; y++) {
    for (let x = 0; x < alpha.width; x++) if (alpha.data[(y * alpha.width + x) * 4 + 3]! > 40) return y;
  }
  return alpha.height;
}

function urlOf(sprites: Sprites, piece: Pick<SceneDrawPiece, 'asset' | 'facing'>): string | undefined {
  const facings = sprites[piece.asset]?.facings;
  return facings?.[piece.facing] ?? (facings ? Object.values(facings)[0] : undefined);
}

/** A cell's outline, from the pack's own cell centres at its corners (a diamond on an iso grid). */
function cellShape(context: CanvasRenderingContext2D, pack: MapPack, doc: SceneDoc, cell: Cell) {
  context.beginPath();
  for (const [dx, dy] of [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ] as const) {
    const point = pack.cellCenter(doc, { x: cell.x + dx, y: cell.y + dy });
    context.lineTo(point.x, point.y);
  }
  context.closePath();
}

export function MapCanvas({
  doc,
  pack,
  sprites,
  selected,
  ghost,
  hover,
  inset,
  onPress,
  onDrag,
  onRelease,
  onCancel,
  onHover,
  children,
}: {
  /** The document to draw; hidden layers are already marked `visible: false`. */
  doc: SceneDoc;
  pack: MapPack;
  sprites: Sprites;
  selected?: TileRef;
  /** A piece drawn half-clear where it would land (painting, or a drag in progress). */
  ghost?: { asset: string; facing: string; cell: Cell };
  hover?: Cell;
  /** Screen space the editor's own bars cover, kept clear when the map is fitted. */
  inset: { top: number; bottom: number };
  onPress(pointer: MapPointer): PressResult;
  onDrag(pointer: MapPointer): void;
  onRelease(pointer: MapPointer): void;
  /** A stroke or drag that ended without landing: a second finger turned it into a pinch, or the browser took it. */
  onCancel(): void;
  onHover(pointer: MapPointer | undefined): void;
  /** Shown above the selected piece (its actions). */
  children?: ReactNode;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<View>();
  const [, setLoaded] = useState(0);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<
    { kind: 'drag' | 'pan'; last: Point } | { kind: 'pinch'; distance: number; mid: Point } | undefined
  >(undefined);
  const pieces = pack.draw(doc);

  useLayoutEffect(() => {
    const element = wrap.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /* Fit the whole map between the bars when it opens and whenever the space changes shape. */
  const fitKey = `${doc.game}/${doc.scene}:${size.width}x${size.height}:${inset.top}:${inset.bottom}`;
  useLayoutEffect(() => {
    if (size.width === 0 || size.height === 0) return;
    const extent = pack.extent(doc);
    const room = { width: size.width - 24, height: Math.max(80, size.height - inset.top - inset.bottom - 24) };
    const scale = Math.min(room.width / extent.width, room.height / extent.height, 1.5);
    setView({
      scale,
      x: (size.width - extent.width * scale) / 2 - extent.left * scale,
      y: inset.top + 12 + (room.height - extent.height * scale) / 2 - extent.top * scale,
    });
    /* refit only when the scene or the space changes */
  }, [fitKey]);

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context || !view) return;
    const ratio = window.devicePixelRatio || 1;
    element.width = Math.round(size.width * ratio);
    element.height = Math.round(size.height * ratio);
    context.setTransform(ratio * view.scale, 0, 0, ratio * view.scale, ratio * view.x, ratio * view.y);
    context.clearRect(-view.x / view.scale, -view.y / view.scale, size.width / view.scale, size.height / view.scale);
    context.imageSmoothingEnabled = view.scale < 1;
    const reload = () => setLoaded((count) => count + 1);
    const style = getComputedStyle(element);
    const color = (name: string) => style.getPropertyValue(name).trim();
    const drawPiece = (
      piece: Pick<SceneDrawPiece, 'asset' | 'facing' | 'center' | 'anchorY' | 'x' | 'y'> & { scale?: number },
    ) => {
      const url = urlOf(sprites, piece);
      const img = url ? image(url, reload) : undefined;
      if (img) {
        const scale = piece.scale ?? 1;
        const bounds = spriteBounds(
          piece.center,
          piece.anchorY,
          { width: img.naturalWidth, height: img.naturalHeight },
          scale,
        );
        context.drawImage(img, bounds.x, bounds.y, bounds.width, bounds.height);
      } else {
        cellShape(context, pack, doc, piece);
        context.fillStyle = color('--map-empty');
        context.fill();
      }
    };
    /* The map's footprint, so empty cells still read as places to paint. */
    if (doc.bounds) {
      const { width, height } = doc.bounds;
      const corner = (x: number, y: number) => pack.cellCenter(doc, { x: x - 0.5, y: y - 0.5 });
      context.beginPath();
      for (const [x, y] of [
        [0, 0],
        [width, 0],
        [width, height],
        [0, height],
      ] as const) {
        const point = corner(x, y);
        context.lineTo(point.x, point.y);
      }
      context.closePath();
      context.fillStyle = color('--map-footprint');
      context.fill();
      context.lineWidth = 2 / view.scale;
      context.strokeStyle = color('--map-footprint-edge');
      context.stroke();
    }
    for (const piece of pieces) {
      drawPiece(piece);
      if (piece.floor && selected && piece.unit === `tile:${selected.layer}:${selected.cell}`) {
        cellShape(context, pack, doc, piece);
        context.fillStyle = color('--map-select-fill');
        context.fill();
      }
    }
    const outline = (cell: Cell, color: string) => {
      cellShape(context, pack, doc, cell);
      context.lineWidth = 3 / view.scale;
      context.strokeStyle = color;
      context.stroke();
    };
    if (hover) outline(hover, color('--map-hover'));
    if (selected) outline(parseCell(selected.cell), color('--map-select'));
    if (ghost) {
      context.globalAlpha = 0.6;
      drawPiece({ ...ghost, ...ghost.cell, center: pack.cellCenter(doc, ghost.cell), anchorY: pack.anchorY });
      context.globalAlpha = 1;
    }
  });

  const pointer = (event: { clientX: number; clientY: number }): MapPointer | undefined => {
    const box = canvas.current?.getBoundingClientRect();
    if (!box || !view) return undefined;
    const point = {
      x: (event.clientX - box.left - view.x) / view.scale,
      y: (event.clientY - box.top - view.y) / view.scale,
    };
    const cell = pack.cellAt(doc, point);
    return { point, ...(cell ? { cell } : {}), ...pick(point, cell) };
  };

  /** The piece drawn on top under a point: tall pieces by their pixels, then the top tile in the cell. */
  function pick(point: Point, cell: Cell | undefined): { pick?: TileRef } {
    for (const piece of [...pieces].reverse()) {
      if (piece.floor) continue;
      const url = urlOf(sprites, piece);
      const img = url ? images.get(url) : undefined;
      if (!url || !img?.naturalWidth) continue;
      const scale = piece.scale ?? 1;
      const bounds = spriteBounds(
        piece.center,
        piece.anchorY,
        { width: img.naturalWidth, height: img.naturalHeight },
        scale,
      );
      const { x, y } = spritePixelAt(point, bounds, scale);
      if (solidAt(url, img, x, y)) return { pick: { layer: piece.layer, cell: piece.cell } };
    }
    if (!cell) return {};
    const key = `${cell.x},${cell.y}`;
    for (const layer of tileLayersFrontToBack(doc)) {
      if (doc.layers[layer]?.visible !== false && doc.layers[layer]?.tiles?.[key])
        return { pick: { layer, cell: key } };
    }
    return {};
  }

  const zoomAt = (screen: Point, factor: number) =>
    setView((current) => {
      if (!current) return current;
      const scale = Math.min(4, Math.max(0.15, current.scale * factor));
      const applied = scale / current.scale;
      return { scale, x: screen.x - (screen.x - current.x) * applied, y: screen.y - (screen.y - current.y) * applied };
    });

  const local = (event: { clientX: number; clientY: number }): Point => {
    const box = canvas.current!.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  const selectedCenter =
    selected && view
      ? (() => {
          const center = pack.cellCenter(doc, parseCell(selected.cell));
          const piece = pieces.find((candidate) => candidate.unit === `tile:${selected.layer}:${selected.cell}`);
          const url = piece ? urlOf(sprites, piece) : undefined;
          const img = url ? images.get(url) : undefined;
          /* Just above the piece's visible top, or the cell's diamond when its picture has not loaded. */
          const top =
            url && img?.naturalWidth
              ? center.y + (solidTop(url, img) - (piece?.anchorY ?? 0)) * (piece?.scale ?? 1) - 8
              : center.y - 40;
          return { x: center.x * view.scale + view.x, y: top * view.scale + view.y };
        })()
      : undefined;

  return (
    <div className="map-canvas" ref={wrap}>
      <canvas
        ref={canvas}
        aria-label="Map"
        data-view={view ? `${view.scale} ${view.x} ${view.y}` : undefined}
        style={{ width: size.width, height: size.height }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture?.(event.pointerId);
          pointers.current.set(event.pointerId, local(event));
          if (pointers.current.size === 2) {
            if (gesture.current?.kind === 'drag') onCancel();
            const [a, b] = [...pointers.current.values()] as [Point, Point];
            gesture.current = {
              kind: 'pinch',
              distance: Math.hypot(a.x - b.x, a.y - b.y),
              mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
            };
            return;
          }
          if (event.button !== 0 && event.pointerType === 'mouse') {
            gesture.current = { kind: 'pan', last: local(event) };
            return;
          }
          const at = pointer(event);
          if (!at) return;
          gesture.current = { kind: onPress(at), last: local(event) };
        }}
        onPointerMove={(event) => {
          const now = local(event);
          if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, now);
          const current = gesture.current;
          if (!current) {
            if (event.pointerType === 'mouse') onHover(pointer(event));
            return;
          }
          if (current.kind === 'pinch') {
            const [a, b] = [...pointers.current.values()] as [Point, Point];
            if (!a || !b) return;
            const distance = Math.hypot(a.x - b.x, a.y - b.y);
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            setView(
              (view) => view && { ...view, x: view.x + mid.x - current.mid.x, y: view.y + mid.y - current.mid.y },
            );
            zoomAt(mid, distance / current.distance);
            gesture.current = { kind: 'pinch', distance, mid };
            return;
          }
          if (current.kind === 'pan') {
            setView(
              (view) => view && { ...view, x: view.x + now.x - current.last.x, y: view.y + now.y - current.last.y },
            );
            current.last = now;
            return;
          }
          const at = pointer(event);
          if (at) onDrag(at);
        }}
        onPointerUp={(event) => {
          pointers.current.delete(event.pointerId);
          const current = gesture.current;
          gesture.current = undefined;
          if (current?.kind === 'drag') {
            const at = pointer(event);
            if (at) onRelease(at);
          }
        }}
        onPointerCancel={(event) => {
          pointers.current.delete(event.pointerId);
          if (gesture.current?.kind === 'drag') onCancel();
          gesture.current = undefined;
        }}
        onPointerLeave={() => onHover(undefined)}
        onWheel={(event) => zoomAt(local(event), Math.exp(-event.deltaY / 400))}
        onContextMenu={(event) => event.preventDefault()}
      />
      {children && selectedCenter ? (
        <div className="map-canvas-float" style={{ left: selectedCenter.x, top: selectedCenter.y }}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
