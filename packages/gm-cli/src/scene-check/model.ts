/** Engine-neutral scene model the structure checks read; readers adapt scene formats into it. */

export type Facing = 'E' | 'N' | 'W' | 'S';
export type CellEdge = 'xMin' | 'xMax' | 'yMin' | 'yMax';
export type Bounds = readonly [left: number, top: number, right: number, bottom: number];

export interface Cell {
  x: number;
  y: number;
}

/** What a piece is to the checks. Structural roles come from pack facts, then a tile's `role`, then the asset name. */
export type Role =
  'ground' | 'path' | 'fence' | 'wall' | 'post' | 'door' | 'opening' | 'roof' | 'seat' | 'prop' | 'unknown';

export interface Piece {
  key: string;
  layer: string;
  x: number;
  y: number;
  asset: string;
  facing: Facing;
  solid: boolean;
  role: Role;
  /** Free-form tile tags: `ruin`, `formal`, `gate`, `exit`. */
  tags: ReadonlySet<string>;
  elevation: number;
  /** The grid edge this piece draws, when its pack measured it. */
  edge?: CellEdge;
  /** The measured edge of every facing of the asset, for suggesting a facing that joins a run. */
  edges?: Partial<Record<Facing, CellEdge>>;
  /** Alpha rectangle in source pixels and the source image size, when measured. */
  alpha?: Bounds;
  size?: readonly [width: number, height: number];
  /** Facings the asset actually ships, when known. */
  facings?: readonly Facing[];
}

export interface Actor {
  id: string;
  name: string;
  prefab?: string;
  x: number;
  y: number;
}

export interface Camera {
  width: number;
  height: number;
  zoom: number;
  center?: Cell;
}

export interface Scene {
  /** Inclusive cell bounds of every map the scene draws. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  pieces: Piece[];
  actors: Actor[];
  /** The pack's sprite anchor: image pixel (width / 2, anchorY) sits on the cell's projected point. */
  anchorY: number;
  tile: readonly [width: number, height: number];
}

export type CheckId =
  | 'connected-runs'
  | 'coherent-buildings'
  | 'no-overlap'
  | 'facing'
  | 'traversable'
  | 'natural-placement'
  | 'framing'
  | 'facts';

export const CHECK_ORDER: readonly CheckId[] = [
  'connected-runs',
  'coherent-buildings',
  'no-overlap',
  'facing',
  'traversable',
  'natural-placement',
  'framing',
  'facts',
];

export type Severity = 'high' | 'medium' | 'low' | 'info';

export interface Finding {
  check: CheckId;
  /** Stable id `<check>/<defect>`; `--allow` and known-limitation lists name it. */
  id: string;
  severity: Severity;
  message: string;
  cells: Cell[];
  objects: string[];
}

export const cellKey = ({ x, y }: Cell): string => `${x},${y}`;

export const NEIGHBORS: readonly (readonly [number, number, CellEdge])[] = [
  [-1, 0, 'xMin'],
  [1, 0, 'xMax'],
  [0, -1, 'yMin'],
  [0, 1, 'yMax'],
];

export function across(cell: Cell, edge: CellEdge): Cell {
  const [dx, dy] = NEIGHBORS.find(([, , name]) => name === edge)!;
  return { x: cell.x + dx, y: cell.y + dy };
}

/** A cell edge as a grid segment between two vertices, with a key shared by both cells that own it. */
export function segment(cell: Cell, edge: CellEdge): { a: Cell; b: Cell; key: string } {
  const { x, y } = cell;
  const ends: Record<CellEdge, [Cell, Cell]> = {
    xMin: [
      { x, y },
      { x, y: y + 1 },
    ],
    xMax: [
      { x: x + 1, y },
      { x: x + 1, y: y + 1 },
    ],
    yMin: [
      { x, y },
      { x: x + 1, y },
    ],
    yMax: [
      { x, y: y + 1 },
      { x: x + 1, y: y + 1 },
    ],
  };
  const [a, b] = ends[edge];
  return { a, b, key: `${a.x === b.x ? 'v' : 'h'}:${a.x},${a.y}` };
}

/** The four grid vertices of a cell. */
export function corners({ x, y }: Cell): Cell[] {
  return [
    { x, y },
    { x: x + 1, y },
    { x, y: y + 1 },
    { x: x + 1, y: y + 1 },
  ];
}

export const STRUCTURE: ReadonlySet<Role> = new Set(['fence', 'wall', 'door', 'opening', 'roof', 'post']);
export const DRESSING: ReadonlySet<Role> = new Set(['prop', 'seat', 'unknown']);
