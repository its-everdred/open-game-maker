// These functions run inside the deployed browser; keep them closure-free for Playwright serialization.
export function reviewRoundMediaReady(): boolean {
  const deck = document.querySelector('.build-review-dialog');
  const image = deck?.querySelector('img') as HTMLImageElement | null;
  const video = deck?.querySelector('video') as HTMLVideoElement | null;
  const audio = deck?.querySelector('audio') as HTMLAudioElement | null;
  return Boolean(image && image.naturalWidth > 0 && video && video.readyState >= 2 && audio && audio.duration > 1);
}

export function reviewOptionImageReady(): boolean {
  const image = document.querySelector('.worker-review-option img') as HTMLImageElement | null;
  return Boolean(image && image.naturalWidth > 0);
}
