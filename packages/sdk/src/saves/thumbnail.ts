/** Capture the largest game canvas without letting a tainted or unavailable canvas break saving. */
export function captureSaveThumbnail(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const source = Array.from(document.querySelectorAll('canvas'))
    .filter((canvas) => canvas.width > 0 && canvas.height > 0)
    .sort((a, b) => b.width * b.height - a.width * a.height)[0];
  if (!source) return undefined;
  try {
    const canvas = document.createElement('canvas');
    const scale = Math.min(160 / source.width, 90 / source.height, 1);
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    // WebGL may have discarded its drawing buffer after compositing; do not present that blank buffer as a screenshot.
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let varied = false;
    for (let index = 4; index < pixels.length; index += 4) {
      if (
        pixels[index] !== pixels[0] ||
        pixels[index + 1] !== pixels[1] ||
        pixels[index + 2] !== pixels[2] ||
        pixels[index + 3] !== pixels[3]
      ) {
        varied = true;
        break;
      }
    }
    if (!varied) return undefined;
    const image = canvas.toDataURL('image/webp', 0.6);
    return image.length <= 32768 && /^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/u.test(image) ? image : undefined;
  } catch {
    return undefined;
  }
}

/** Sample after game frame callbacks, before the browser composites a non-preserved WebGL buffer. */
export function createSaveThumbnailCache(options: {
  onFrame(callback: () => void): () => void;
  capture?: () => string | undefined;
  now?: () => number;
}) {
  const capture = options.capture ?? captureSaveThumbnail;
  const now = options.now ?? (() => performance.now());
  let lastCapture = -Infinity;
  let frozenAt: number | undefined;
  let current: string | undefined;
  const history: { at: number; image: string }[] = [];
  const historyLimit = 13;
  let queued = false;
  let disposed = false;
  const stop = options.onFrame(() => {
    const time = now();
    if (frozenAt !== undefined || queued || time - lastCapture < 1_000) return;
    queued = true;
    lastCapture = time;
    queueMicrotask(() => {
      queued = false;
      if (disposed) return;
      current = capture();
      if (current) {
        const capturedAt = now();
        history.push({ at: capturedAt, image: current });
        while (history.length > historyLimit) history.shift();
      }
    });
  });
  return {
    current: () => current,
    atOffset: (offsetMs: 0 | 5_000 | 10_000) => {
      if (history.length === 0) return undefined;
      const target = (frozenAt ?? now()) - offsetMs;
      const sample = history.filter((item) => item.at <= target).at(-1);
      return sample && target - sample.at <= 2_500 ? sample : undefined;
    },
    pause: () => {
      if (frozenAt !== undefined) return;
      frozenAt = now();
      const pausedImage = capture();
      if (pausedImage) {
        current = pausedImage;
        history.push({ at: frozenAt, image: current });
        while (history.length > historyLimit) history.shift();
      }
    },
    resume: () => {
      frozenAt = undefined;
    },
    dispose: () => {
      disposed = true;
      stop();
    },
  };
}
