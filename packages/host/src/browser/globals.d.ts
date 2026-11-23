interface Window {
  __host: {
    errors: unknown[];
    ready: { id: string }[];
    relays: unknown[];
    forge(): void;
  };
  __frames: { source?: string }[];
  __taps: number;
  __cacheReady: Promise<unknown>;
  __started: boolean;
  __drawFirstFrame: () => void;
  __pad: { buttons: { pressed: boolean; touched: boolean; value: number }[] };
}
