export type Obstacle = { x: number; z: number; yaw: number; halfX: number; halfZ: number };
export function blocked(point: number[], obstacles: Obstacle[]): boolean;
export function route(start: number[], end: number[], obstacles: Obstacle[], step?: number, maxVisited?: number): number[][] | null;
export function simplifyPath(path: number[][], obstacles: Obstacle[]): number[][];
export function clearSegment(from: number[], to: number[], obstacles: Obstacle[]): boolean;
