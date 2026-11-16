/** A port is one of the four tile edges (0 = top, clockwise), or -1 for a dead end. */
export type Port = number;
export type Point = [x: number, y: number];

export interface GridSize {
  cols: number;
  rows: number;
}

export interface Tile {
  readonly type: TrackType;
  readonly turn: number;
  readonly branch: boolean;
}
export type Grid = readonly (Tile | null)[];

/** A grid of track squares. The flat grid is meaningless without its width, so they travel together. */
export interface Board {
  readonly grid: Grid;
  readonly cols: number;
  readonly rows: number;
}

export interface Car {
  readonly type: StockType;
  readonly color: ColorName;
}

/** One route across one square, entering at `from` and leaving at `to`. */
export interface SegmentRef {
  readonly index: number;
  readonly from: Port;
  readonly to: Port;
}

interface SegmentEnds extends SegmentRef {
  readonly a: Readonly<Point>;
  readonly b: Readonly<Point>;
  readonly length: number;
}
export interface StraightSegment extends SegmentEnds {
  turn?: undefined;
}
export interface CurvedSegment extends SegmentEnds {
  readonly cx: number;
  readonly cy: number;
  readonly angle: number;
  readonly turn: number;
}
export type Segment = StraightSegment | CurvedSegment;

export interface Position {
  x: number;
  y: number;
  angle: number;
  index: number;
}
export type CarPosition = Position & Car;

export const COLS = 17;
export const ROWS = 14;
export const GRID_SIZES: (GridSize & { label: string })[] = [
  { cols: COLS, rows: ROWS, label: "Standard" },
  { cols: 12, rows: 9, label: "Large" },
  { cols: 9, rows: 7, label: "Extra large" },
  { cols: 7, rows: 5, label: "Biggest" },
];

export const ENDS: Point[] = [
  [0.5, 0],
  [1, 0.5],
  [0.5, 1],
  [0, 0.5],
];
const STEPS: Point[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
export const OPPOSITE: readonly Port[] = [2, 3, 0, 1];
const QUARTER_TURN = Math.PI / 2;

/** Catalogs list entries in palette order; `inPalette` entries appear in the palette. */
interface TrackInfo {
  name: string;
  paths: [Port, Port][];
  inPalette: boolean;
}
export const TRACK = {
  straight: { name: "Straight", paths: [[3, 1]], inPalette: true },
  curve: { name: "Curve", paths: [[1, 2]], inPalette: true },
  cross: {
    name: "Crossing",
    paths: [
      [3, 1],
      [0, 2],
    ],
    inPalette: true,
  },
  wye: {
    name: "Y-switch",
    paths: [
      [3, 0],
      [3, 2],
    ],
    inPalette: true,
  },
  left: {
    name: "Left switch",
    paths: [
      [3, 1],
      [3, 0],
    ],
    inPalette: true,
  },
  right: {
    name: "Right switch",
    paths: [
      [3, 1],
      [3, 2],
    ],
    inPalette: true,
  },
  station: { name: "Station", paths: [[3, 1]], inPalette: true },
  buffer: { name: "Buffer stop", paths: [[3, -1]], inPalette: true },
  bridge: { name: "Bridge", paths: [[3, 1]], inPalette: true },
  tunnel: { name: "Tunnel", paths: [[3, 1]], inPalette: true },
} satisfies Record<string, TrackInfo>;
export type TrackType = keyof typeof TRACK;

interface StockInfo {
  name: string;
  engine?: boolean;
  inPalette: boolean;
}
export const STOCK = {
  steam: { name: "Steam engine", engine: true, inPalette: true },
  diesel: { name: "Diesel engine", engine: true, inPalette: true },
  electric: { name: "Electric engine", engine: true, inPalette: true },
  tender: { name: "Coal tender", inPalette: true },
  hopper: { name: "Hopper", inPalette: true },
  log: { name: "Log car", inPalette: true },
  tank: { name: "Tank car", inPalette: true },
  box: { name: "Boxcar", inPalette: true },
  flat: { name: "Flatcar", inPalette: true },
  crane: { name: "Crane car", inPalette: true },
  passenger: { name: "Passenger coach", inPalette: true },
  caboose: { name: "Caboose", inPalette: true },
} satisfies Record<string, StockInfo>;
export type StockType = keyof typeof STOCK;

export const isEngine = (type: StockType): boolean => (STOCK[type] as StockInfo).engine === true;

const catalogKeys = <T extends string>(catalog: Record<T, { inPalette: boolean }>) =>
  (Object.keys(catalog) as T[]).filter((key) => catalog[key].inPalette);
export const TRACK_PALETTE: TrackType[] = catalogKeys(TRACK);
export const STOCK_PALETTE: StockType[] = catalogKeys(STOCK);

export const BACKGROUNDS = {
  plain: "Grass",
  meadow: "Meadow",
  coast: "Coast",
  mountain: "Mountains",
  desert: "Desert",
} satisfies Record<string, string>;
export type Background = keyof typeof BACKGROUNDS;

export function isBackground(value: unknown): value is Background {
  return typeof value === "string" && Object.hasOwn(BACKGROUNDS, value);
}
export const COLORS = {
  brick: ["Brick red", "#bb493b"],
  coral: ["Coral", "#dd765c"],
  amber: ["Golden yellow", "#d59832"],
  mint: ["Mint", "#7fa996"],
  pine: ["Pine green", "#427454"],
  teal: ["Teal", "#3f8581"],
  ocean: ["Ocean blue", "#3c719a"],
  violet: ["Plum", "#825878"],
  pink: ["Rose", "#bd6b8c"],
  cream: ["Cream", "#ede0bb"],
  brown: ["Chestnut", "#8b5b3d"],
  slate: ["Slate", "#535c66"],
} satisfies Record<string, [name: string, hex: string]>;
export type ColorName = keyof typeof COLORS;

export const indexAt = (x: number, y: number, cols: number) => y * cols + x;
export const cellAt = (index: number, cols: number): Point => [
  index % cols,
  Math.floor(index / cols),
];
export const isSwitch = <T extends { type: TrackType }>(tile: T | null | undefined): tile is T =>
  tile?.type === "left" || tile?.type === "right" || tile?.type === "wye";

type Orientation = Pick<Tile, "type" | "turn"> & { branch?: boolean };

export function trackPaths(tile: Orientation, all = false): Port[][] {
  const paths: Port[][] = TRACK[tile.type].paths;
  const selected = isSwitch(tile) && !all ? [paths[Number(tile.branch)]] : paths;
  return selected.map((path) => path.map((port) => (port === -1 ? -1 : (port + tile.turn) % 4)));
}

export function hasPort(tile: Orientation | null | undefined, port: Port) {
  return Boolean(tile && trackPaths(tile, true).some((route) => route.includes(port)));
}

export function neighbor({ cols, rows }: Board, index: number, port: Port) {
  if (port === -1) return -1;
  const [x, y] = cellAt(index, cols);
  const [dx, dy] = STEPS[port];
  const nx = x + dx;
  const ny = y + dy;
  return nx < 0 || ny < 0 || nx >= cols || ny >= rows ? -1 : indexAt(nx, ny, cols);
}

function orientations(type: TrackType): Tile[] {
  const paths: [Port, Port][] = TRACK[type].paths;
  const [first, second] = paths[0];
  const straight = paths.length === 1 && OPPOSITE[first] === second;
  const turns = straight ? [0, 1] : type === "cross" ? [0] : [0, 1, 2, 3];
  return turns.map((turn) => ({ type, turn, branch: false }));
}

function connectedPorts(board: Board, index: number, tile: Orientation) {
  return ENDS.flatMap((_, port) =>
    hasPort(tile, port) && hasPort(board.grid[neighbor(board, index, port)], OPPOSITE[port])
      ? [port]
      : [],
  );
}

export type TrackEdit = [index: number, tile: Tile];

export function fitTrack(
  board: Board,
  index: number,
  type: TrackType,
  occupied: ReadonlySet<number> = new Set(),
  original: Tile | null = null,
): TrackEdit[] {
  const adjacent = ENDS.map((_, port): { index: number; tile?: Tile | null; rotated?: Tile } => {
    const nextIndex = neighbor(board, index, port);
    const tile = board.grid[nextIndex];
    const entry = OPPOSITE[port];
    if (!tile || hasPort(tile, entry)) return { index: nextIndex, tile };
    if (occupied.has(nextIndex) || connectedPorts(board, nextIndex, tile).length)
      return { index: nextIndex };
    const rotated = orientations(tile.type).find((option) => hasPort(option, entry));
    return { index: nextIndex, rotated };
  });
  let bestScore = -1;
  let best: TrackEdit[] = [];
  for (const orientation of orientations(type)) {
    const tile = original ? { ...original, turn: orientation.turn } : orientation;
    const edits: TrackEdit[] = [[index, tile]];
    let score = 0;
    adjacent.forEach((next, port) => {
      if (!hasPort(tile, port)) return;
      if (next.tile) score += 5;
      if (next.rotated) {
        score += 1;
        edits.push([next.index, next.rotated]);
      }
    });
    if (score > bestScore || (score === bestScore && tile.turn === original?.turn)) {
      bestScore = score;
      best = edits;
    }
  }
  return best;
}

export function rotateTrack(board: Board, index: number): Tile | null {
  const tile = board.grid[index];
  if (!tile) return null;
  const options = orientations(tile.type);
  const fullyConnected = isSwitch(tile) && connectedPorts(board, index, tile).length === 3;
  const connected = options.filter(
    (option) => connectedPorts(board, index, option).length >= (fullyConnected ? 3 : 1),
  );
  const valid = connected.length ? connected : options;
  const turn = tile.turn % options.length;
  const next = valid.find((option) => option.turn > turn) ?? valid[0];
  if (next.turn !== turn) return { ...tile, turn: next.turn };
  return fullyConnected ? { ...tile, branch: !tile.branch } : null;
}

export function switchBranch(board: Board, index: number, tile: Tile) {
  const [[, main], [, branch]] = trackPaths(tile, true);
  const mainConnected = hasPort(board.grid[neighbor(board, index, main)], OPPOSITE[main]);
  const branchConnected = hasPort(board.grid[neighbor(board, index, branch)], OPPOSITE[branch]);
  return mainConnected === branchConnected ? tile.branch : branchConnected;
}

export function segment(index: number, from: Port, to: Port): Segment {
  const a = ENDS[from] ?? [0.5, 0.5];
  const b = ENDS[to] ?? [0.5, 0.5];
  if (from === -1 || to === -1 || OPPOSITE[from] === to) {
    return { index, from, to, a, b, length: from === -1 || to === -1 ? 0.5 : 1 };
  }
  const cx = a[0] === 0.5 ? b[0] : a[0];
  const cy = a[1] === 0.5 ? b[1] : a[1];
  const angle = Math.atan2(a[1] - cy, a[0] - cx);
  const delta = (a[0] - cx) * (b[1] - cy) - (a[1] - cy) * (b[0] - cx);
  return { index, from, to, a, b, cx, cy, angle, turn: Math.sign(delta), length: Math.PI / 4 };
}

export function pointOn(path: Segment, fraction: number): [x: number, y: number, angle: number] {
  if (!path.turn) {
    const dx = path.b[0] - path.a[0];
    const dy = path.b[1] - path.a[1];
    return [path.a[0] + dx * fraction, path.a[1] + dy * fraction, Math.atan2(dy, dx)];
  }
  const angle = path.angle + path.turn * fraction * QUARTER_TURN;
  return [
    path.cx + 0.5 * Math.cos(angle),
    path.cy + 0.5 * Math.sin(angle),
    angle + path.turn * QUARTER_TURN,
  ];
}

export function nextSegments(board: Board, path: SegmentRef): Segment[] {
  const index = neighbor(board, path.index, path.to);
  const tile = board.grid[index];
  if (!tile) return [];
  const entry = OPPOSITE[path.to];
  const routes = trackPaths(tile, true);
  if (isSwitch(tile) && switchBranch(board, index, tile)) routes.reverse();
  return routes
    .filter((route) => route.includes(entry))
    .map((route) =>
      segment(
        index,
        entry,
        route.find((port) => port !== entry)!,
      ),
    );
}

export function onward(board: Board, path: SegmentRef): Segment | null {
  return nextSegments(board, path)[0] ?? null;
}

export function position(path: Segment, distance: number, cols: number): Position {
  const [x, y, angle] = pointOn(path, distance / path.length);
  const [column, row] = cellAt(path.index, cols);
  return { x: column + x, y: row + y, angle, index: path.index };
}

/** Identifies a route across a square, so segments compare by value rather than identity. */
export function pathKey(path: SegmentRef) {
  return path.index + ":" + path.from + ":" + path.to;
}

/** The routes on a tile nearest a point within its square, preferred route first. */
export function routesAt(tile: Tile, x: number, y: number) {
  const routes = trackPaths(tile, true);
  if (isSwitch(tile) && tile.branch) routes.reverse();
  if (tile.type !== "cross") return routes;
  const port = Math.abs(x - 0.5) < Math.abs(y - 0.5) ? 0 : 1;
  return routes.filter((route) => route.includes(port));
}

/** Whether `from`→`to` (in either direction) is a route on the tile at `index`. */
export function isRoute(board: Board, { index, from, to }: SegmentRef) {
  if (!Number.isInteger(index) || index < 0 || index >= board.cols * board.rows) return false;
  const tile = board.grid[index];
  return Boolean(
    tile &&
    from !== to &&
    trackPaths(tile, true).some(([a, b]) => (a === from && b === to) || (a === to && b === from)),
  );
}

/** Whether `next` continues from `path`: it is on the square beyond `path.to` and enters from the opposite side. */
export function leadsInto(board: Board, path: SegmentRef, next: SegmentRef) {
  return (
    path.to !== -1 &&
    next.index === neighbor(board, path.index, path.to) &&
    next.from === OPPOSITE[path.to]
  );
}

export function blankBoard({ cols, rows }: GridSize = GRID_SIZES[0]): Board {
  return { grid: Array(cols * rows).fill(null), cols, rows };
}

export const TUNNEL_HALF_LENGTH = 0.4;
export const TUNNEL_HALF_WIDTH = 0.27;
export type Joins = readonly [start: boolean, end: boolean];

/** Whether the bridge or tunnel at (x, y) continues into the matching piece before and after it. */
export function structureJoins(board: Board | undefined, x: number, y: number, tile: Tile): Joins {
  if (!board) return [false, false];
  const { grid, cols, rows } = board;
  const vertical = tile.turn % 2;
  const joined = (step: number) => {
    const nx = x + (vertical ? 0 : step);
    const ny = y + (vertical ? step : 0);
    if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) return false;
    const neighbor = grid[indexAt(nx, ny, cols)];
    return neighbor?.type === tile.type && neighbor.turn % 2 === vertical;
  };
  return [joined(-1), joined(1)];
}

/** Whether the board point (in squares) is hidden under a tunnel roof. */
export function underTunnelRoof(board: Board, x: number, y: number) {
  const col = Math.floor(x);
  const row = Math.floor(y);
  if (col < 0 || col >= board.cols || row < 0 || row >= board.rows) return false;
  const tile = board.grid[indexAt(col, row, board.cols)];
  if (tile?.type !== "tunnel") return false;
  const vertical = tile.turn % 2;
  const along = vertical ? y - row - 0.5 : x - col - 0.5;
  const across = vertical ? x - col - 0.5 : y - row - 0.5;
  if (Math.abs(across) > TUNNEL_HALF_WIDTH) return false;
  if (Math.abs(along) <= TUNNEL_HALF_LENGTH) return true;
  const joins = structureJoins(board, col, row, tile);
  return joins[along < 0 ? 0 : 1];
}
