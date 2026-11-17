/** UI sprites drawn during the most recent frame, in CSS pixels. */
export type ImageDraw = {
  id: string;
  file: string;
  source: { width: number; height: number };
  drawn: { width: number; height: number };
};

let current: ImageDraw[] = [];

/** Call at the start of each UI frame, then report each visible sprite. */
export function beginImageDraws(): void {
  current = [];
}

export function reportImageDraw(draw: ImageDraw): void {
  current.push(structuredClone(draw));
}

export function imageDraws(): ImageDraw[] {
  return structuredClone(current);
}
