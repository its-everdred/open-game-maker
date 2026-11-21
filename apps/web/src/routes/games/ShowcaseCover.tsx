import { useEffect, useLayoutEffect, useRef, useState } from 'react';

type SceneModule = {
  ready: Promise<unknown>;
  SCENES: Record<string, { cover: [number, number] }>;
  paint(canvas: HTMLCanvasElement, id: string, scene: number, time: number): void;
  blueprint(context: CanvasRenderingContext2D, time: number, width: number, height: number, progress: number): void;
};
let sceneModule: Promise<SceneModule> | undefined;
const lastFrames = new Map<string, HTMLCanvasElement>();
const sceneArt: Record<string, string> = {
  'goblin-cellar': 'goblin-fight.webp',
  'mossy-leap': 'pp-tiles.png',
  'skyward-squadron': 'shmup-tiles.png',
  'powder-rush': 'ski.png',
  'little-fronts': 'battle.png',
};
function availableArt(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = `/proto/art/${name}`;
  });
}
function loadScenes(): Promise<SceneModule> {
  return (sceneModule ??= (import('virtual:showcase-scenes') as Promise<SceneModule>).catch((error: unknown) => {
    sceneModule = undefined;
    throw error;
  }));
}

export function ShowcaseCover({ id, title, hero }: { id: string; title: string; hero: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [painted, setPainted] = useState(false);
  useLayoutEffect(() => {
    const target = canvas.current;
    const previous = lastFrames.get(id);
    if (!target || !previous) return;
    target.width = previous.width;
    target.height = previous.height;
    target.getContext('2d')?.drawImage(previous, 0, 0);
    setPainted(true);
  }, [id]);
  useEffect(() => {
    setPainted(lastFrames.has(id));
    let active = true;
    let visible = true;
    let frame = 0;
    let draw: FrameRequestCallback | undefined;
    const target = canvas.current;
    if (!target) return;
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? undefined
        : new IntersectionObserver(([entry]) => {
            visible = entry?.isIntersecting ?? false;
            if (!visible) {
              cancelAnimationFrame(frame);
              frame = 0;
            } else if (draw && !frame) frame = requestAnimationFrame(draw);
          });
    observer?.observe(target);
    void loadScenes()
      .then(async (scenes) => {
        await scenes.ready;
        const key = id;
        const definition = scenes.SCENES[key];
        const art = sceneArt[key];
        if (!active || (key !== 'puddle-postal' && (!definition || !art || !(await availableArt(art))))) return;
        if (!active) return;
        const [index, start] = definition?.cover ?? [0, 0];
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
        const started = performance.now();
        draw = (now: number) => {
          frame = 0;
          if (!active) return;
          if (visible) {
            if (key === 'puddle-postal') {
              target.width = 320;
              target.height = 180;
              const context = target.getContext('2d');
              if (context) scenes.blueprint(context, (now - started) / 1000, 320, 180, 0);
            } else {
              scenes.paint(target, key, hero ? 0 : index, start + (hero && !reduced ? (now - started) / 1000 : 0));
            }
            if (!lastFrames.has(key)) {
              const frameCopy = document.createElement('canvas');
              frameCopy.width = target.width;
              frameCopy.height = target.height;
              frameCopy.getContext('2d')?.drawImage(target, 0, 0);
              lastFrames.set(key, frameCopy);
            }
            setPainted(true);
          }
          if (!reduced && visible && (hero || key === 'puddle-postal')) frame = requestAnimationFrame(draw!);
        };
        if (visible) frame = requestAnimationFrame(draw);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [hero, id]);
  return (
    <>
      {!painted && (
        <div className="game-cover-placeholder" aria-hidden="true">
          <span>{title}</span>
        </div>
      )}
      <canvas ref={canvas} className="game-showcase-canvas" data-painted={painted} aria-hidden="true" />
    </>
  );
}
