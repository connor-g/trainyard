/** A port is one of the four tile edges (0 = top, clockwise), or -1 for a dead end. */
export type Port = number;
export type Point = [x: number, y: number];

export interface GridSize {
  cols: number;
  rows: number;
}

export interface Tile {
  type: TrackType;
  turn: number;
  branch: boolean;
}
export type Grid = (Tile | null)[];

/** A grid of track squares. The flat grid is meaningless without its width, so they travel together. */
export interface Board {
  grid: Grid;
  cols: number;
  rows: number;
}

export interface Car {
  type: StockType;
  color: ColorName;
}

interface SegmentEnds {
  index: number;
  from: Port;
  to: Port;
  a: Point;
  b: Point;
  length: number;
}
export interface StraightSegment extends SegmentEnds {
  turn?: undefined;
}
export interface CurvedSegment extends SegmentEnds {
  cx: number;
  cy: number;
  angle: number;
  turn: number;
}
export type Segment = StraightSegment | CurvedSegment;

/** Unique for the whole session. Assigned when a train is created or a yard is loaded; never saved. */
export type TrainId = number & { readonly __brand: "TrainId" };

let lastTrainId = 0;
export const nextTrainId = () => ++lastTrainId as TrainId;

export interface Train {
  id: TrainId;
  cars: Car[];
  history: Segment[];
  progress: number;
}

export interface Layout {
  name: string;
  board: Board;
  background: Background;
  trains: Train[];
}

export interface Position {
  x: number;
  y: number;
  angle: number;
  index: number;
}
export type CarPosition = Position & Car;

interface StationStop {
  path: string;
  remaining: number;
}
interface CrossingRequest {
  path: string;
  crossing: number;
  order: number;
}
interface CrossingApproach {
  path: Segment;
  crossing: number;
  untilStop: number;
  order?: number;
}

/** Simulation bookkeeping that isn't part of a train's position, keyed by train. */
export interface SimState {
  stationStops: Map<TrainId, StationStop>;
  crossingRequests: Map<TrainId, CrossingRequest>;
  crossingArrival: number;
}

export const initialSimState = (): SimState => ({
  stationStops: new Map(),
  crossingRequests: new Map(),
  crossingArrival: 0,
});

export const COLS = 17;
export const ROWS = 14;
export const GRID_SIZES: (GridSize & { label: string })[] = [
  { cols: COLS, rows: ROWS, label: "Standard" },
  { cols: 12, rows: 9, label: "Large" },
  { cols: 9, rows: 7, label: "Extra large" },
  { cols: 7, rows: 5, label: "Biggest" },
];

export function gridSize(size: { cols?: unknown; rows?: unknown }) {
  return (
    GRID_SIZES.find(({ cols, rows }) => cols === size.cols && rows === size.rows) ?? GRID_SIZES[0]
  );
}

export function expandStandardYard<T extends { cols?: unknown; rows?: unknown; grid?: unknown }>(
  layout: T,
): T {
  const previousRows = 12;
  const legacySize =
    (layout.cols === COLS && layout.rows === previousRows) ||
    (layout.cols === undefined && layout.rows === undefined);
  if (!legacySize || !Array.isArray(layout.grid) || layout.grid.length !== COLS * previousRows)
    return layout;
  // Appending rows keeps every track and train history index at the same coordinates.
  return {
    ...layout,
    cols: COLS,
    rows: ROWS,
    grid: [...layout.grid, ...Array(COLS * (ROWS - previousRows)).fill(null)],
  };
}
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
const OPPOSITE: readonly Port[] = [2, 3, 0, 1];
const QUARTER_TURN = Math.PI / 2;
const CAR_GAP = 0.7;
const MAX_CARS = 24;
const STATION_STOP_SECONDS = 1.6;
const CROSSING_CLEARANCE = 0.38;
const CROSSING_STOP_DISTANCE = 0.42;

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

function hasPort(tile: Orientation | null | undefined, port: Port) {
  return Boolean(tile && trackPaths(tile, true).some((route) => route.includes(port)));
}

function neighbor({ cols, rows }: Board, index: number, port: Port) {
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

function nextSegments(board: Board, path: Segment) {
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

function onward(board: Board, path: Segment) {
  return nextSegments(board, path)[0] ?? null;
}

function head(train: Train) {
  return train.history[train.history.length - 1];
}

export function position(path: Segment, distance: number, cols: number): Position {
  const [x, y, angle] = pointOn(path, distance / path.length);
  const [column, row] = cellAt(path.index, cols);
  return { x: column + x, y: row + y, angle, index: path.index };
}

export function carPositions(train: Train, cols: number) {
  const positions: CarPosition[] = [];
  let pathIndex = train.history.length - 1;
  let distance = train.progress;
  for (const car of train.cars) {
    while (distance < 0 && pathIndex > 0) {
      pathIndex -= 1;
      distance += train.history[pathIndex].length;
    }
    if (distance < 0) break;
    positions.push({ ...position(train.history[pathIndex], distance, cols), ...car });
    distance -= CAR_GAP;
  }
  return positions;
}

function addTailHistory(board: Board, train: Train) {
  let available =
    train.progress + train.history.slice(0, -1).reduce((total, path) => total + path.length, 0);
  const seen = new Set(train.history.map(pathKey));
  while (available < (train.cars.length - 1) * CAR_GAP) {
    const first = train.history[0];
    const previous = onward(board, segment(first.index, first.to, first.from));
    if (!previous) break;
    const path = segment(previous.index, previous.to, previous.from);
    const key = pathKey(path);
    if (seen.has(key)) break;
    seen.add(key);
    train.history.unshift(path);
    available += path.length;
  }
}

function pathKey(path: Segment) {
  return path.index + ":" + path.from + ":" + path.to;
}

function routesAt(tile: Tile, x: number, y: number) {
  const routes = trackPaths(tile, true);
  if (isSwitch(tile) && tile.branch) routes.reverse();
  if (tile.type !== "cross") return routes;
  const port = Math.abs(x - 0.5) < Math.abs(y - 0.5) ? 0 : 1;
  return routes.filter((route) => route.includes(port));
}

export function startTrain(
  board: Board,
  index: number,
  car: Car,
  localX = 0.5,
  localY = 0.5,
  reverse = false,
): Train | null {
  const tile = board.grid[index];
  if (!tile) return null;
  const routes = routesAt(tile, localX, localY);
  const paths = routes.map(([from, to]) => segment(index, from, to));
  const reversed = routes.map(([from, to]) => segment(index, to, from));
  const candidates = reverse ? [...reversed, ...paths] : [...paths, ...reversed];
  const path = candidates.find((candidate) => onward(board, candidate)) ?? paths[0];
  return { id: nextTrainId(), cars: [car], history: [path], progress: path.length / 2 };
}

export function nearestTrain(
  board: Board,
  trains: Train[],
  index: number,
  localX = 0.5,
  localY = 0.5,
) {
  const tile = board.grid[index];
  if (!tile || !trains.length) return null;
  const queues = routesAt(tile, localX, localY).flatMap(([a, b]) => [
    segment(index, a, b),
    segment(index, b, a),
  ]);
  const visited = new Set<string>();
  const anchors = trains.map((train) => {
    const path = head(train);
    return { train, index: path.index, from: path.from, to: path.to };
  });
  for (const path of queues) {
    const key = pathKey(path);
    if (visited.has(key)) continue;
    visited.add(key);
    const match = anchors.find(
      (anchor) =>
        path.index === anchor.index &&
        ((path.from === anchor.from && path.to === anchor.to) ||
          (path.from === anchor.to && path.to === anchor.from)),
    );
    if (match) return match.train;
    queues.push(...nextSegments(board, path));
  }
  return null;
}

export function couple(
  board: Board,
  train: Train,
  car: Car,
  insertAt = train.cars.length,
): string | null {
  if (train.cars.length >= MAX_CARS) return "A train can hold up to " + MAX_CARS + " cars.";
  let path: Segment | null = head(train);
  const visited = new Map<string, number>();
  let distance = 0;
  while (path) {
    const key = pathKey(path);
    if (visited.has(key)) {
      const circuit = distance - visited.get(key)!;
      if (circuit < (train.cars.length + 1) * CAR_GAP)
        return "This loop is too short for another car.";
      break;
    }
    visited.set(key, distance);
    distance += path.length;
    path = onward(board, path);
  }
  const withCar = { ...train, cars: [...train.cars], history: [...train.history] };
  withCar.cars.splice(insertAt, 0, car);
  addTailHistory(board, withCar);
  if (!path) {
    const behind =
      withCar.progress +
      withCar.history.slice(0, -1).reduce((total, segment) => total + segment.length, 0);
    const ahead = Math.max(0, distance - withCar.progress - 0.29);
    if (behind + ahead < train.cars.length * CAR_GAP)
      return "Add more track before coupling another car.";
  }
  train.cars = withCar.cars;
  train.history = withCar.history;
  return null;
}

function crossingTraffic(board: Board, trains: Train[], sim: SimState, distance: number) {
  const { grid } = board;
  const owners = new Map<number, Train>();
  const approaches = new Map<Train, CrossingApproach>();
  const encroaching = new Map<Train, Segment>();
  for (const train of trains) {
    const path = head(train);
    const nextIndex = neighbor(board, path.index, path.to);
    const next = grid[nextIndex]?.type === "cross" ? onward(board, path) : null;
    const headIndex = train.history.length - 1;
    let behind = 0;
    const tail = (train.cars.length - 1) * CAR_GAP + CROSSING_CLEARANCE;
    // Reserve the entire length of the train, including the gaps between cars.
    for (let i = headIndex; i >= 0 && behind <= tail; i -= 1) {
      const segment = train.history[i];
      if (grid[segment.index]?.type === "cross" && !owners.has(segment.index))
        owners.set(segment.index, train);
      behind += i === headIndex ? train.progress : segment.length;
    }
    if (!next) {
      sim.crossingRequests.delete(train.id);
      continue;
    }
    const untilStop = path.length - train.progress - CROSSING_STOP_DISTANCE;
    if (untilStop > distance) {
      sim.crossingRequests.delete(train.id);
      continue;
    }
    approaches.set(train, { path, crossing: next.index, untilStop });
    if (path.length - train.progress < CROSSING_CLEARANCE) encroaching.set(train, next);
  }
  for (const [train, path] of encroaching) {
    if (!owners.has(path.index)) owners.set(path.index, train);
  }

  // For arrivals within the same frame, the closer train reached the stop line first.
  const arrivals = [...approaches].sort(([, a], [, b]) => a.untilStop - b.untilStop);
  for (const [train, approach] of arrivals) {
    const previous = sim.crossingRequests.get(train.id);
    const path = pathKey(approach.path);
    if (previous?.path === path && previous.crossing === approach.crossing) {
      approach.order = previous.order;
    } else {
      approach.order = sim.crossingArrival++;
      sim.crossingRequests.set(train.id, {
        path,
        crossing: approach.crossing,
        order: approach.order,
      });
    }
  }
  arrivals.sort(([, a], [, b]) => a.order! - b.order!);
  for (const [train, { crossing }] of arrivals) {
    if (!owners.has(crossing)) owners.set(crossing, train);
  }
  return { owners, approaches, encroaching };
}

export function advance(
  board: Board,
  trains: Train[],
  sim: SimState,
  distance: number,
  seconds = distance / 1.6,
  onStation: () => void = () => {},
  onMove?: (train: Train) => void,
) {
  const { grid, cols } = board;
  const movingEngines = new Set<StockType>();
  const occupied = trains.map((train) => carPositions(train, cols));
  const ids = new Set(trains.map((train) => train.id));
  for (const id of sim.stationStops.keys()) if (!ids.has(id)) sim.stationStops.delete(id);
  for (const id of sim.crossingRequests.keys()) if (!ids.has(id)) sim.crossingRequests.delete(id);
  const traffic = trains.length > 1 ? crossingTraffic(board, trains, sim, distance) : null;
  trains.forEach((train, index) => {
    let path = head(train);
    const crossing = grid[path.index]?.type === "cross" ? path : null;
    const owner = crossing && traffic?.owners.get(crossing.index);
    const ownerPath = owner && (traffic?.encroaching.get(owner) ?? head(owner));
    if (
      owner &&
      ownerPath &&
      owner !== train &&
      ownerPath.index === crossing.index &&
      ownerPath.from % 2 !== crossing.from % 2
    )
      return;
    const key = pathKey(path);
    let stop = sim.stationStops.get(train.id);
    if (stop && stop.path !== key) {
      // The train has left the platform, so it can stop there again next time round.
      sim.stationStops.delete(train.id);
      stop = undefined;
    }
    if (stop && stop.remaining > 0) {
      stop.remaining -= seconds;
      return;
    }
    let progress = train.progress + distance;
    const approach = traffic?.approaches.get(train);
    if (approach && traffic?.owners.get(approach.crossing) !== train) {
      progress = train.progress + Math.max(0, approach.untilStop);
    }
    let next: Segment | null = null;
    const midpoint = path.length / 2;
    const arriving =
      grid[path.index]?.type === "station" &&
      !stop &&
      train.progress <= midpoint &&
      progress >= midpoint &&
      distance > 0;
    if (arriving) {
      progress = midpoint;
    } else if (progress >= path.length) {
      next = onward(board, path);
      progress = next
        ? progress - path.length
        : Math.max(train.progress, path.length - Math.min(0.29, path.length / 2));
      if (next) path = next;
    } else if (path.length - progress < 0.29 && !onward(board, path)) {
      progress = Math.max(train.progress, path.length - Math.min(0.29, path.length / 2));
    }
    const candidate = position(path, progress, cols);
    const blocked = occupied.some((cars, other) => {
      if (other === index) return false;
      // Let the owner clear a crossing where an older save left two trains nose to nose.
      const otherTrain = trains[other];
      const otherPath = traffic?.encroaching.get(otherTrain) ?? head(otherTrain);
      const clearingJam =
        owner === train &&
        crossing !== null &&
        otherPath.index === crossing.index &&
        otherPath.from % 2 !== crossing.from % 2;
      return (
        !clearingJam &&
        cars.some((car) => Math.hypot(candidate.x - car.x, candidate.y - car.y) < 0.58)
      );
    });
    if (blocked) return;
    const moved = next || progress > train.progress;
    if (moved) {
      for (const car of train.cars) if (isEngine(car.type)) movingEngines.add(car.type);
    }
    if (next) train.history.push(next);
    train.progress = progress;
    if (arriving) {
      sim.stationStops.set(train.id, { path: pathKey(path), remaining: STATION_STOP_SECONDS });
      onStation();
    }
    let remaining = (train.cars.length - 1) * CAR_GAP - progress;
    let keepFrom = train.history.length - 1;
    while (keepFrom > 0 && remaining > 0) {
      keepFrom -= 1;
      remaining -= train.history[keepFrom].length;
    }
    // A few previous pieces let a new car appear immediately when coupled.
    train.history.splice(0, Math.max(0, keepFrom - 2));
    occupied[index] = carPositions(train, cols);
    if (moved) onMove?.(train);
  });
  return movingEngines;
}

export function blankBoard({ cols, rows }: GridSize = GRID_SIZES[0]): Board {
  return { grid: Array(cols * rows).fill(null), cols, rows };
}

export function blankLayout(
  size: GridSize = GRID_SIZES[0],
  background: Background = "plain",
): Layout {
  return { name: "New Layout", board: blankBoard(size), background, trains: [] };
}

function firstCarSegment(train: Train) {
  let index = train.history.length - 1;
  let distance = train.progress - (train.cars.length - 1) * CAR_GAP;
  while (index > 0 && distance < 0) {
    index -= 1;
    distance += train.history[index].length;
  }
  return index;
}

export function resizeLayout(layout: Layout, { cols, rows }: GridSize): Layout | null {
  const old = layout.board;
  const used = old.grid.flatMap((tile, index) => (tile ? [cellAt(index, old.cols)] : []));
  const requiredHistory = layout.trains.map(firstCarSegment);
  layout.trains.forEach((train, i) => {
    for (const path of train.history.slice(requiredHistory[i]))
      used.push(cellAt(path.index, old.cols));
  });
  const shift = [cols, rows].map((size, axis) => {
    if (!used.length) return 0;
    let low = -Infinity;
    let high = Infinity;
    for (const cell of used) {
      low = Math.max(low, -cell[axis]);
      high = Math.min(high, size - 1 - cell[axis]);
    }
    if (low > high) return null;
    const centered = Math.floor((size - (axis === 0 ? old.cols : old.rows)) / 2);
    return Math.min(high, Math.max(low, centered));
  });
  const [dx, dy] = shift;
  if (dx == null || dy == null) return null;
  const move = (index: number) => {
    const [x, y] = cellAt(index, old.cols);
    if (x + dx < 0 || x + dx >= cols || y + dy < 0 || y + dy >= rows) return -1;
    return indexAt(x + dx, y + dy, cols);
  };
  const grid: Grid = Array(cols * rows).fill(null);
  old.grid.forEach((tile, index) => {
    if (tile) grid[move(index)] = tile;
  });
  const trains = layout.trains.map((train) => {
    const history = train.history.map((path) => ({ ...path, index: move(path.index) }));
    return {
      ...train,
      history: history.slice(history.findLastIndex((path) => path.index === -1) + 1),
    };
  });
  return { ...layout, board: { grid, cols, rows }, trains };
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
