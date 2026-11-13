declare module 'virtual:showcase-scenes' {
  export const ready: Promise<unknown>;
  export const SCENES: Record<string, { cover: [number, number] }>;
  export function paint(canvas: HTMLCanvasElement, id: string, scene: number, time: number): void;
  export function blueprint(
    context: CanvasRenderingContext2D,
    time: number,
    width: number,
    height: number,
    progress: number,
  ): void;
}
