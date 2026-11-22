type Quality = 'off' | 'low' | 'high';

/** Mean and p95 wall-clock ms of the fixture's `frame()` calls, per quality tier. */
export type FrameStats = Partial<Record<Quality, { mean: number; p95: number; frames: number }>>;

declare global {
  interface Window {
    /** The HD-2D fixture's test hooks; the browser specs drive the clearing through them. */
    __hd2d?: {
      ready: boolean;
      frame(ms: number): Promise<void>;
      hash(): string;
      info(): {
        renderer: 'phaser' | 'three';
        mounted: string[];
        frameMs: FrameStats;
        /** `?facade=1`: the running scene document as JSON. */
        scene?: string;
      };
      /** `?facade=1`: applies a scene document to the running instance. */
      applyScene?(json: string): void;
    };
  }
}
