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
  if (
    typeof window !== 'undefined' &&
    (window as unknown as { __gmCapturePausedAt?: number }).__gmCapturePausedAt !== undefined
  )
    return;
  current = [];
  lastFrame = performance.now();
  if (typeof window !== 'undefined') (window as unknown as { __gmBeginUiFrame?: () => void }).__gmBeginUiFrame?.();
}

/** Clear the previous game's report and its registration. */
export function resetImageDraws(): void {
  current = [];
  lastFrame = undefined;
}

export function imageDrawsReady(): boolean {
  const now =
    typeof window === 'undefined'
      ? performance.now()
      : ((window as unknown as { __gmCapturePausedAt?: number }).__gmCapturePausedAt ?? performance.now());
  return lastFrame !== undefined && now - lastFrame < 1_000;
}

export function reportImageDraw(draw: ImageDraw): void {
  if (
    typeof window !== 'undefined' &&
    (window as unknown as { __gmCapturePausedAt?: number }).__gmCapturePausedAt !== undefined
  )
    return;
  current.push(structuredClone(draw));
}

export function imageDraws(): ImageDraw[] {
  return structuredClone(current);
}
