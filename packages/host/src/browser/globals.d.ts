interface Window {
  __host: {
    frame: import('../frame.js').GameFrame;
    errors: unknown[];
    ready: { id: string }[];
    relays: unknown[];
    loads: string[];
    forge(): void;
  };
  __frames: { source?: string }[];
  __taps: number;
  __cacheReady: Promise<unknown>;
  __started: boolean;
  __drawFirstFrame: () => void;
  __pad: { buttons: { pressed: boolean; touched: boolean; value: number }[] };
}
