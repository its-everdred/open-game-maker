export type Obstacle = { x: number; z: number; yaw: number; halfX: number; halfZ: number };
export function blocked(point: number[], obstacles: Obstacle[]): boolean;
export function route(start: number[], end: number[], obstacles: Obstacle[], step?: number): number[][] | null;
