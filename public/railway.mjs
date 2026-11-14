export const COLS = 17;
export const ROWS = 14;
export const GRID_SIZES = [
  {cols: COLS, rows: ROWS, label: 'Standard'},
  {cols: 12, rows: 9, label: 'Large'},
  {cols: 9, rows: 7, label: 'Extra large'},
  {cols: 7, rows: 5, label: 'Biggest'},
];

export function gridSize(layout) {
  return GRID_SIZES.find(({cols, rows}) => cols === layout.cols && rows === layout.rows) ?? GRID_SIZES[0];
}

export function expandStandardYard(layout) {
  const previousRows = 12;
  const legacySize = (layout.cols === COLS && layout.rows === previousRows) ||
    (layout.cols === undefined && layout.rows === undefined);
  if (!legacySize || !Array.isArray(layout.grid) || layout.grid.length !== COLS * previousRows) return layout;
  // Appending rows keeps every track and train history index at the same coordinates.
  return {...layout, cols: COLS, rows: ROWS, grid: [...layout.grid, ...Array(COLS * (ROWS - previousRows)).fill(null)]};
}
export const ENDS = [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]];
const STEPS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const OPPOSITE = [2, 3, 0, 1];
const QUARTER_TURN = Math.PI / 2;
const CAR_GAP = 0.70;
const MAX_CARS = 24;
const STATION_STOP_SECONDS = 1.6;
const stationStops = new WeakMap();
const CROSSING_CLEARANCE = 0.38;
const CROSSING_STOP_DISTANCE = 0.42;
const crossingRequests = new WeakMap();
let crossingArrival = 0;

export const TRACK = {
  straight: {name: 'Straight', paths: [[3, 1]]},
  curve: {name: 'Curve', paths: [[1, 2]]},
  cross: {name: 'Crossing', paths: [[3, 1], [0, 2]]},
  right: {name: 'Right switch', paths: [[3, 1], [3, 2]]},
  left: {name: 'Left switch', paths: [[3, 1], [3, 0]]},
  buffer: {name: 'Buffer stop', paths: [[3, -1]]},
  station: {name: 'Station', paths: [[3, 1]]},
  bridge: {name: 'Bridge', paths: [[3, 1]]},
  tunnel: {name: 'Tunnel', paths: [[3, 1]]},
  wye: {name: 'Y-switch', paths: [[3, 0], [3, 2]]},
};
export const STOCK = {
  steam: {name: 'Steam engine', engine: true},
  diesel: {name: 'Diesel engine', engine: true},
  electric: {name: 'Electric engine', engine: true},
  box: {name: 'Boxcar'},
  tank: {name: 'Tank car'},
  flat: {name: 'Flatcar'},
  hopper: {name: 'Hopper'},
  caboose: {name: 'Caboose'},
  passenger: {name: 'Passenger coach'},
  log: {name: 'Log car'},
  crane: {name: 'Crane car'},
  snowplow: {name: 'Snowplow', engine: true},
  tender: {name: 'Coal tender'},
};
export const COLORS = {
  brick: ['Brick red', '#bb493b'],
  coral: ['Coral', '#dd765c'],
  amber: ['Golden yellow', '#d59832'],
  mint: ['Mint', '#7fa996'],
  pine: ['Pine green', '#427454'],
  teal: ['Teal', '#3f8581'],
  ocean: ['Ocean blue', '#3c719a'],
  violet: ['Plum', '#825878'],
  pink: ['Rose', '#bd6b8c'],
  cream: ['Cream', '#ede0bb'],
  brown: ['Chestnut', '#8b5b3d'],
  slate: ['Slate', '#535c66'],
};

export const indexAt = (x, y, cols = COLS) => y * cols + x;
export const cellAt = (index, cols = COLS) => [index % cols, Math.floor(index / cols)];
export const isSwitch = tile => ['left', 'right', 'wye'].includes(tile?.type);

export function trackPaths(tile, all = false) {
  const {paths} = TRACK[tile.type];
  const selected = isSwitch(tile) && !all ? [paths[Number(tile.branch)]] : paths;
  return selected.map(path => path.map(port => port === -1 ? -1 : (port + tile.turn) % 4));
}

function hasPort(tile, port) {
  return Boolean(tile && trackPaths(tile, true).some(route => route.includes(port)));
}

function neighbor(grid, index, port, cols) {
  if (port === -1) return -1;
  const [x, y] = cellAt(index, cols);
  const [dx, dy] = STEPS[port];
  const nx = x + dx;
  const ny = y + dy;
  return nx < 0 || ny < 0 || nx >= cols || ny >= grid.length / cols ? -1 : indexAt(nx, ny, cols);
}

function orientations(type) {
  const paths = TRACK[type].paths;
  const straight = paths.length === 1 && OPPOSITE[paths[0][0]] === paths[0][1];
  const turns = straight ? [0, 1] : type === 'cross' ? [0] : [0, 1, 2, 3];
  return turns.map(turn => ({type, turn, branch: false}));
}

function connectedPorts(grid, index, tile, cols) {
  return ENDS.flatMap((_, port) => hasPort(tile, port) &&
    hasPort(grid[neighbor(grid, index, port, cols)], OPPOSITE[port]) ? [port] : []);
}

export function fitTrack(grid, index, type, occupied = new Set(), original = null, cols = COLS) {
  const adjacent = ENDS.map((_, port) => {
    const nextIndex = neighbor(grid, index, port, cols);
    const tile = grid[nextIndex];
    const entry = OPPOSITE[port];
    if (!tile || hasPort(tile, entry)) return {index: nextIndex, tile};
    if (occupied.has(nextIndex) || connectedPorts(grid, nextIndex, tile, cols).length) return {index: nextIndex};
    const rotated = orientations(tile.type).find(option => hasPort(option, entry));
    return {index: nextIndex, rotated};
  });
  let bestScore = -1;
  let best;
  for (const orientation of orientations(type)) {
    const tile = original ? {...original, turn: orientation.turn} : orientation;
    const edits = [[index, tile]];
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

export function rotateTrack(grid, index, cols = COLS) {
  const tile = grid[index];
  const options = orientations(tile.type);
  const fullyConnected = isSwitch(tile) && connectedPorts(grid, index, tile, cols).length === 3;
  const connected = options.filter(option => connectedPorts(grid, index, option, cols).length >= (fullyConnected ? 3 : 1));
  const valid = connected.length ? connected : options;
  const turn = tile.turn % options.length;
  const next = valid.find(option => option.turn > turn) ?? valid[0];
  if (next.turn !== turn) return {...tile, turn: next.turn};
  return fullyConnected ? {...tile, branch: !tile.branch} : null;
}

export function switchBranch(grid, index, tile, cols = COLS) {
  const [main, branch] = trackPaths(tile, true);
  const mainConnected = hasPort(grid[neighbor(grid, index, main[1], cols)], OPPOSITE[main[1]]);
  const branchConnected = hasPort(grid[neighbor(grid, index, branch[1], cols)], OPPOSITE[branch[1]]);
  return mainConnected === branchConnected ? tile.branch : branchConnected;
}

export function segment(index, from, to) {
  const a = ENDS[from] ?? [0.5, 0.5];
  const b = ENDS[to] ?? [0.5, 0.5];
  if (from === -1 || to === -1 || OPPOSITE[from] === to) {
    return {index, from, to, a, b, length: from === -1 || to === -1 ? 0.5 : 1};
  }
  const cx = a[0] === 0.5 ? b[0] : a[0];
  const cy = a[1] === 0.5 ? b[1] : a[1];
  const angle = Math.atan2(a[1] - cy, a[0] - cx);
  const delta = (a[0] - cx) * (b[1] - cy) - (a[1] - cy) * (b[0] - cx);
  return {index, from, to, a, b, cx, cy, angle, turn: Math.sign(delta), length: Math.PI / 4};
}

export function pointOn(path, fraction) {
  if (!path.turn) {
    const dx = path.b[0] - path.a[0];
    const dy = path.b[1] - path.a[1];
    return [path.a[0] + dx * fraction, path.a[1] + dy * fraction, Math.atan2(dy, dx)];
  }
  const angle = path.angle + path.turn * fraction * QUARTER_TURN;
  return [path.cx + 0.5 * Math.cos(angle), path.cy + 0.5 * Math.sin(angle), angle + path.turn * QUARTER_TURN];
}

function nextSegments(grid, path, cols) {
  const index = neighbor(grid, path.index, path.to, cols);
  const tile = grid[index];
  if (!tile) return [];
  const entry = OPPOSITE[path.to];
  const routes = trackPaths(tile, true);
  if (isSwitch(tile) && switchBranch(grid, index, tile, cols)) routes.reverse();
  return routes.filter(route => route.includes(entry)).map(route =>
    segment(index, entry, route.find(port => port !== entry)));
}

function onward(grid, path, cols) {
  return nextSegments(grid, path, cols)[0] ?? null;
}

function head(train) {
  return train.history[train.history.length - 1];
}

export function position(path, distance, cols = COLS) {
  const [x, y, angle] = pointOn(path, distance / path.length);
  const [column, row] = cellAt(path.index, cols);
  return {x: column + x, y: row + y, angle, index: path.index};
}

export function carPositions(train, cols = COLS) {
  const positions = [];
  let pathIndex = train.history.length - 1;
  let distance = train.progress;
  for (const car of train.cars) {
    while (distance < 0 && pathIndex > 0) {
      pathIndex -= 1;
      distance += train.history[pathIndex].length;
    }
    if (distance < 0) break;
    positions.push({...position(train.history[pathIndex], distance, cols), ...car});
    distance -= CAR_GAP;
  }
  return positions;
}

function addTailHistory(grid, train, cols) {
  let available = train.progress + train.history.slice(0, -1).reduce((total, path) => total + path.length, 0);
  const seen = new Set(train.history.map(pathKey));
  while (available < (train.cars.length - 1) * CAR_GAP) {
    const first = train.history[0];
    const previous = onward(grid, segment(first.index, first.to, first.from), cols);
    if (!previous) break;
    const path = segment(previous.index, previous.to, previous.from);
    const key = pathKey(path);
    if (seen.has(key)) break;
    seen.add(key);
    train.history.unshift(path);
    available += path.length;
  }
}

function pathKey(path) {
  return path.index + ':' + path.from + ':' + path.to;
}

function routesAt(tile, x, y) {
  const routes = trackPaths(tile, true);
  if (isSwitch(tile) && tile.branch) routes.reverse();
  if (tile.type !== 'cross') return routes;
  const port = Math.abs(x - 0.5) < Math.abs(y - 0.5) ? 0 : 1;
  return routes.filter(route => route.includes(port));
}

export function startTrain(grid, index, car, localX = 0.5, localY = 0.5, reverse = false, cols = COLS) {
  const tile = grid[index];
  if (!tile) return null;
  const routes = routesAt(tile, localX, localY);
  const paths = routes.map(([from, to]) => segment(index, from, to));
  const reversed = routes.map(([from, to]) => segment(index, to, from));
  const candidates = reverse ? [...reversed, ...paths] : [...paths, ...reversed];
  const path = candidates.find(candidate => onward(grid, candidate, cols)) ?? paths[0];
  return {cars: [car], history: [path], progress: path.length / 2};
}

export function nearestTrain(grid, trains, index, localX = 0.5, localY = 0.5, cols = COLS) {
  const tile = grid[index];
  if (!tile || !trains.length) return null;
  const queues = routesAt(tile, localX, localY).flatMap(([a, b]) => [segment(index, a, b), segment(index, b, a)]);
  const visited = new Set();
  const anchors = trains.map(train => {
    const path = head(train);
    return {train, index: path.index, from: path.from, to: path.to};
  });
  for (const path of queues) {
    const key = pathKey(path);
    if (visited.has(key)) continue;
    visited.add(key);
    const match = anchors.find(anchor => path.index === anchor.index &&
      ((path.from === anchor.from && path.to === anchor.to) || (path.from === anchor.to && path.to === anchor.from)));
    if (match) return match.train;
    queues.push(...nextSegments(grid, path, cols));
  }
  return null;
}

export function couple(grid, train, car, cols = COLS, insertAt = train.cars.length) {
  if (train.cars.length >= MAX_CARS) return 'A train can hold up to ' + MAX_CARS + ' cars.';
  let path = head(train);
  const visited = new Map();
  let distance = 0;
  while (path) {
    const key = pathKey(path);
    if (visited.has(key)) {
      const circuit = distance - visited.get(key);
      if (circuit < (train.cars.length + 1) * CAR_GAP) return 'This loop is too short for another car.';
      break;
    }
    visited.set(key, distance);
    distance += path.length;
    path = onward(grid, path, cols);
  }
  const withCar = {...train, cars: [...train.cars], history: [...train.history]};
  withCar.cars.splice(insertAt, 0, car);
  addTailHistory(grid, withCar, cols);
  if (!path) {
    const behind = withCar.progress + withCar.history.slice(0, -1).reduce((total, segment) => total + segment.length, 0);
    const ahead = Math.max(0, distance - withCar.progress - 0.29);
    if (behind + ahead < train.cars.length * CAR_GAP) return 'Add more track before coupling another car.';
  }
  train.cars = withCar.cars;
  train.history = withCar.history;
  return null;
}

function crossingTraffic(grid, trains, distance, cols) {
  const owners = new Map();
  const approaches = new Map();
  const encroaching = new Map();
  for (const train of trains) {
    const path = head(train);
    const nextIndex = neighbor(grid, path.index, path.to, cols);
    const next = grid[nextIndex]?.type === 'cross' ? onward(grid, path, cols) : null;
    const headIndex = train.history.length - 1;
    let behind = 0;
    const tail = (train.cars.length - 1) * CAR_GAP + CROSSING_CLEARANCE;
    // Reserve the entire length of the train, including the gaps between cars.
    for (let i = headIndex; i >= 0 && behind <= tail; i -= 1) {
      const segment = train.history[i];
      if (grid[segment.index]?.type === 'cross' && !owners.has(segment.index)) owners.set(segment.index, train);
      behind += i === headIndex ? train.progress : segment.length;
    }
    if (!next) {
      crossingRequests.delete(train);
      continue;
    }
    const untilStop = path.length - train.progress - CROSSING_STOP_DISTANCE;
    if (untilStop > distance) {
      crossingRequests.delete(train);
      continue;
    }
    approaches.set(train, {path, crossing: next.index, untilStop});
    if (path.length - train.progress < CROSSING_CLEARANCE) encroaching.set(train, next);
  }
  for (const [train, path] of encroaching) {
    if (!owners.has(path.index)) owners.set(path.index, train);
  }

  // For arrivals within the same frame, the closer train reached the stop line first.
  const arrivals = [...approaches].sort(([, a], [, b]) => a.untilStop - b.untilStop);
  for (const [train, approach] of arrivals) {
    const previous = crossingRequests.get(train);
    if (previous?.path === approach.path && previous.crossing === approach.crossing) {
      approach.order = previous.order;
    } else {
      approach.order = crossingArrival++;
      crossingRequests.set(train, approach);
    }
  }
  arrivals.sort(([, a], [, b]) => a.order - b.order);
  for (const [train, {crossing}] of arrivals) {
    if (!owners.has(crossing)) owners.set(crossing, train);
  }
  return {owners, approaches, encroaching};
}

export function advance(grid, trains, distance, cols = COLS, seconds = distance / 1.6, onStation = () => {}, onMove) {
  const movingEngines = new Set();
  const occupied = trains.map(train => carPositions(train, cols));
  const traffic = trains.length > 1 ? crossingTraffic(grid, trains, distance, cols) : null;
  trains.forEach((train, index) => {
    let path = head(train);
    const crossing = grid[path.index]?.type === 'cross' ? path : null;
    const owner = crossing && traffic?.owners.get(crossing.index);
    const ownerPath = owner && (traffic.encroaching.get(owner) ?? head(owner));
    if (owner && owner !== train && ownerPath.index === crossing.index &&
        ownerPath.from % 2 !== crossing.from % 2) return;
    const stop = stationStops.get(train);
    if (stop?.path === path && stop.remaining > 0) {
      stop.remaining -= seconds;
      return;
    }
    let progress = train.progress + distance;
    const approach = traffic?.approaches.get(train);
    if (approach && traffic.owners.get(approach.crossing) !== train) {
      progress = train.progress + Math.max(0, approach.untilStop);
    }
    let next = null;
    const midpoint = path.length / 2;
    const arriving = grid[path.index]?.type === 'station' && stop?.path !== path &&
      train.progress <= midpoint && progress >= midpoint && distance > 0;
    if (arriving) {
      progress = midpoint;
    } else if (progress >= path.length) {
      next = onward(grid, path, cols);
      progress = next ? progress - path.length : Math.max(train.progress, path.length - Math.min(0.29, path.length / 2));
      if (next) path = next;
    } else if (path.length - progress < 0.29 && !onward(grid, path, cols)) {
      progress = Math.max(train.progress, path.length - Math.min(0.29, path.length / 2));
    }
    const candidate = position(path, progress, cols);
    const blocked = occupied.some((cars, other) => {
      if (other === index) return false;
      // Let the owner clear a crossing where an older save left two trains nose to nose.
      const otherTrain = trains[other];
      const otherPath = traffic?.encroaching.get(otherTrain) ?? head(otherTrain);
      const clearingJam = owner === train && otherPath.index === crossing.index &&
        otherPath.from % 2 !== crossing.from % 2;
      return !clearingJam && cars.some(car => Math.hypot(candidate.x - car.x, candidate.y - car.y) < 0.58);
    });
    if (blocked) return;
    const moved = next || progress > train.progress;
    if (moved) {
      for (const car of train.cars) if (STOCK[car.type].engine) movingEngines.add(car.type);
    }
    if (next) train.history.push(next);
    train.progress = progress;
    if (arriving) {
      stationStops.set(train, {path, remaining: STATION_STOP_SECONDS});
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

export function blankLayout({cols, rows} = GRID_SIZES[0]) {
  return {name: 'New Layout', cols, rows, grid: Array(cols * rows).fill(null), trains: [], landscape: false};
}

function firstCarSegment(train) {
  let index = train.history.length - 1;
  let distance = train.progress - (train.cars.length - 1) * CAR_GAP;
  while (index > 0 && distance < 0) {
    index -= 1;
    distance += train.history[index].length;
  }
  return index;
}

export function resizeLayout(layout, {cols, rows}) {
  const old = gridSize(layout);
  const used = layout.grid.flatMap((tile, index) => tile ? [cellAt(index, old.cols)] : []);
  const requiredHistory = layout.trains.map(firstCarSegment);
  layout.trains.forEach((train, i) => {
    for (const path of train.history.slice(requiredHistory[i])) used.push(cellAt(path.index, old.cols));
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
  if (shift.includes(null)) return null;
  const [dx, dy] = shift;
  const move = index => {
    const [x, y] = cellAt(index, old.cols);
    if (x + dx < 0 || x + dx >= cols || y + dy < 0 || y + dy >= rows) return -1;
    return indexAt(x + dx, y + dy, cols);
  };
  const grid = Array(cols * rows).fill(null);
  layout.grid.forEach((tile, index) => { if (tile) grid[move(index)] = tile; });
  const trains = layout.trains.map(train => {
    const history = train.history.map(path => ({...path, index: move(path.index)}));
    return {...train, history: history.slice(history.findLastIndex(path => path.index === -1) + 1)};
  });
  return {...layout, cols, rows, grid, trains};
}

export function sampleLayout() {
  const layout = blankLayout();
  layout.name = 'Meadow Loop';
  layout.landscape = true;
  const put = (x, y, type, turn = 0) => {
    layout.grid[indexAt(x, y)] = {type, turn, branch: false};
  };
  put(3, 2, 'curve');
  put(13, 2, 'curve', 1);
  put(13, 9, 'curve', 2);
  put(3, 9, 'curve', 3);
  for (let x = 4; x < 13; x += 1) {
    put(x, 2, 'straight');
    put(x, 9, 'straight');
  }
  for (let y = 3; y < 9; y += 1) {
    put(3, y, 'straight', 1);
    put(13, y, 'straight', 1);
  }
  // The inner route rejoins the loop through the second switch.
  put(6, 2, 'right');
  put(11, 2, 'left', 2);
  put(6, 3, 'straight', 1);
  put(11, 3, 'straight', 1);
  put(6, 4, 'curve', 3);
  put(11, 4, 'curve', 2);
  for (let x = 7; x < 11; x += 1) put(x, 4, 'straight');
  const train = startTrain(layout.grid, indexAt(6, 9), {type: 'steam', color: 'brick'}, 0.5, 0.5, true);
  couple(layout.grid, train, {type: 'box', color: 'amber'});
  couple(layout.grid, train, {type: 'caboose', color: 'pine'});
  layout.trains.push(train);
  return layout;
}
