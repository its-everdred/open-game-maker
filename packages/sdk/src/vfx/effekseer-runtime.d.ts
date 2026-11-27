/** The part of Effekseer for WebGL 1.80.8 (`third_party/effekseer/effekseer.d.ts`) the SDK calls. */
declare module 'effekseer-runtime' {
  export interface EffekseerEffect {
    readonly isLoaded: boolean;
    /** 0 when the file did not parse: the runtime then never calls onload or onerror. */
    readonly nativeptr: number;
  }

  export interface EffekseerHandle {
    readonly exists: boolean;
    stop(): void;
    setLocation(x: number, y: number, z: number): void;
  }

  export interface EffekseerContext {
    init(
      gl: WebGLRenderingContext | WebGL2RenderingContext,
      settings?: { instanceMaxCount?: number; squareMaxCount?: number },
    ): void;
    update(deltaFrames?: number): void;
    draw(): void;
    setProjectionMatrix(matrix: Float32Array): void;
    setCameraMatrix(matrix: Float32Array): void;
    loadEffect(
      data: string | ArrayBuffer,
      scale?: number,
      onload?: () => void,
      onerror?: (reason: string, path: string) => void,
      redirect?: (path: string) => string,
    ): EffekseerEffect;
    releaseEffect(effect: EffekseerEffect): void;
    play(effect: EffekseerEffect, x: number, y: number, z: number): EffekseerHandle | null;
    stopAll(): void;
    getRestInstancesCount(): number;
  }

  export interface EffekseerRuntime {
    initRuntime(path: string, onload: () => void, onerror: () => void): void;
    createContext(): EffekseerContext;
    releaseContext(context: EffekseerContext): void;
  }

  const effekseer: EffekseerRuntime;
  export default effekseer;
}
