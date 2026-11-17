/** UI sprites drawn during the most recent frame, in CSS pixels. */
export type ImageDraw = {
  id: string;
  file: string;
  source: { width: number; height: number };
  drawn: { width: number; height: number };
};

let current: ImageDraw[] = [];
let lastFrame: number | undefined;

/** Call at the start of each UI frame, then report each visible sprite. */
export function beginImageDraws(): void {
  current = [];
  lastFrame = performance.now();
}

/** Clear the previous game's report and its registration. */
export function resetImageDraws(): void {
  current = [];
  lastFrame = undefined;
}

export function imageDrawsReady(): boolean {
  return lastFrame !== undefined && performance.now() - lastFrame < 1_000;
}

export function reportImageDraw(draw: ImageDraw): void {
  current.push(structuredClone(draw));
}

export function imageDraws(): ImageDraw[] {
  return structuredClone(current);
}
